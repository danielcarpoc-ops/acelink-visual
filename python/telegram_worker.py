import sys
import json
import asyncio
import re
import os

# Try to set encoding, ignore if fails
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except:
    pass

from telethon import TelegramClient

SESSION_FILE = "telegram_session"


def debug(msg):
    print(f"[DEBUG] {msg}")
    sys.stdout.flush()


async def main():
    client = None
    try:
        # Read command
        input_data = sys.stdin.readline()
        if not input_data:
            return

        command_obj = json.loads(input_data)
        command = command_obj.get("command")

        # Try to load config from file
        config = {}
        if os.path.exists("config.json"):
            try:
                with open("config.json", "r") as f:
                    config = json.load(f)
            except:
                pass

        # Use config file or command line arguments
        api_id = command_obj.get("apiId") or config.get("api_id")
        api_hash = command_obj.get("apiHash") or config.get("api_hash")
        phone = command_obj.get("phone")

        if not api_id or not api_hash:
            print(
                json.dumps(
                    {
                        "status": "error",
                        "message": "Missing API Credentials. Create config.json with api_id and api_hash",
                    }
                )
            )
            return

        client = TelegramClient(SESSION_FILE, api_id, api_hash)
        await client.connect()

        if command == "login":
            if not await client.is_user_authorized():
                sent_code = await client.send_code_request(phone)
                print(
                    json.dumps(
                        {
                            "status": "needs_code",
                            "phone": phone,
                            "phone_code_hash": sent_code.phone_code_hash,
                        }
                    )
                )
            else:
                print(json.dumps({"status": "authorized"}))

        elif command == "submit_code":
            code = command_obj.get("code")
            phone_code_hash = command_obj.get("phoneCodeHash")
            try:
                await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
                print(json.dumps({"status": "authorized"}))
            except Exception as e:
                print(json.dumps({"status": "error", "message": str(e)}))

        elif command == "fetch_channels":
            if not await client.is_user_authorized():
                print(json.dumps({"status": "error", "message": "Not authorized"}))
                return

            found_items = []
            main_chat = None

            # 1. Search for Chat
            debug("Scanning dialogs...")
            async for dialog in client.iter_dialogs(limit=50):
                dname = dialog.name or ""
                # debug(f"Found dialog: {dname}")
                if "Deportes AceStream" in dname:
                    main_chat = dialog
                    debug(f"MATCH: Found main chat '{dname}' (ID: {dialog.id})")
                    break

            if not main_chat:
                # Try fallback matching
                async for dialog in client.iter_dialogs(limit=50):
                    if "AceStream" in (dialog.name or ""):
                        main_chat = dialog
                        debug(f"FALLBACK MATCH: {dialog.name}")
                        break

            if not main_chat:
                print(json.dumps({"status": "success", "data": []}))
                return

            # Helper to parse
            async def parse_messages(entity, topic_id=None, type_tag="channel"):
                local_data = []
                kwargs = {"limit": 50}
                if topic_id:
                    kwargs["reply_to"] = topic_id

                try:
                    async for message in client.iter_messages(entity, **kwargs):
                        if not message.text:
                            continue
                        # Regex for ID
                        matches = re.finditer(
                            r"(?:acestream://)?([a-f0-9]{40})",
                            message.text,
                            re.IGNORECASE,
                        )
                        for match in matches:
                            ace_id = match.group(1)
                            # Parse name (line above)
                            full_text = message.text
                            lines = full_text.split("\n")
                            match_idx = -1
                            for idx, line in enumerate(lines):
                                if ace_id in line:
                                    match_idx = idx
                                    break

                            name = "Unknown"
                            if match_idx > 0:
                                prev = lines[match_idx - 1].strip()
                                if len(prev) < 100:
                                    name = prev

                            if name == "Unknown":
                                clean = (
                                    lines[match_idx]
                                    .replace(ace_id, "")
                                    .replace("acestream://", "")
                                    .strip()
                                )
                                if len(clean) > 2 and len(clean) < 60:
                                    name = clean

                            if name == "Unknown":
                                name = f"Stream {ace_id[:6]}"

                            local_data.append(
                                {
                                    "name": name,
                                    "id": ace_id,
                                    "type": type_tag,
                                    "source": "Deportes AceStream",
                                }
                            )
                except Exception as e:
                    debug(f"Error scanning messages: {e}")
                return local_data

            # 2. Check Forum Status
            is_forum = getattr(main_chat.entity, "forum", False)
            debug(f"Is Forum: {is_forum}")

            if not is_forum:
                # Simple Group
                debug("Scanning simple group...")
                found_items.extend(await parse_messages(main_chat))
            else:
                # FORUM HANDLING
                # Try to get topics
                try:
                    from telethon.tl.functions.messages import GetForumTopicsRequest

                    debug("Fetching topics...")

                    # Request topics
                    # We remove 'q' param to see if that helps
                    result = await client(
                        GetForumTopicsRequest(
                            peer=main_chat,
                            offset_date=None,
                            offset_id=0,
                            offset_topic=0,
                            limit=100,
                        )
                    )

                    topics = getattr(result, "topics", [])
                    debug(f"Found {len(topics)} topics")

                    # Normalize function: remove non-alphanumeric, lower case
                    def normalize(text):
                        return re.sub(r"[^\w\s]", "", text).lower()

                    target_map = {"ids": "channel", "evento": "event", "web": "channel"}

                    for t in topics:
                        raw_title = getattr(t, "title", "")
                        title_norm = normalize(raw_title)
                        tid = t.id
                        debug(f"Topic: '{raw_title}' -> '{title_norm}' (ID: {tid})")

                        category = None
                        for k, v in target_map.items():
                            if k in title_norm:
                                category = v
                                break

                        if category:
                            debug(
                                f"MATCH! Scanning topic '{raw_title}' as {category}..."
                            )
                            found_items.extend(
                                await parse_messages(main_chat, tid, category)
                            )
                        else:
                            debug(f"Skipping topic '{raw_title}' (no match)")

                except Exception as e:
                    debug(f"Failed to fetch topics: {e}")
                    # Fallback: Try scanning main chat without topic ID (some general messages?)
                    found_items.extend(await parse_messages(main_chat))

            # Dedupe based on ID AND Type
            # We want to allow the same ID to appear in 'channel' and 'event' lists
            unique = []
            seen = set()
            for i in found_items:
                # Create a unique key for this item: ID + Type
                key = (i["id"], i["type"])

                if key not in seen:
                    unique.append(i)
                    seen.add(key)

            debug(f"Returning {len(unique)} items")
            print(json.dumps({"status": "success", "data": unique}))

    except Exception as e:
        debug(f"CRITICAL ERROR: {e}")
        print(json.dumps({"status": "error", "message": str(e)}))
    finally:
        if client:
            await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
