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

import base64

from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.auth import ExportLoginTokenRequest, ImportLoginTokenRequest
from telethon.tl.types.auth import LoginToken, LoginTokenMigrateTo, LoginTokenSuccess

SESSION_FILE = "telegram_session"

# Determine writable base directory.
# In production (Electron packaged app), ACELINK_USER_DATA is set to app.getPath('userData').
# In dev, fall back to the project root (current working directory).
_user_data = os.environ.get("ACELINK_USER_DATA", "")
if _user_data:
    os.makedirs(_user_data, exist_ok=True)
    SESSION_FILE = os.path.join(_user_data, "telegram_session")
    _CONFIG_PATH = os.path.join(_user_data, "config.json")
else:
    _CONFIG_PATH = "config.json"

# Fallback config path (points to Resources/config.json in packaged app)
_CONFIG_FALLBACK = os.environ.get("ACELINK_CONFIG_FALLBACK", "")


def debug(msg):
    print(f"[DEBUG] {msg}", file=sys.stderr)
    sys.stderr.flush()


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
        # Try primary path (userData), then fallback (Resources/config.json in packaged app)
        for cfg_path in [_CONFIG_PATH, _CONFIG_FALLBACK]:
            if cfg_path and os.path.exists(cfg_path):
                try:
                    with open(cfg_path, "r") as f:
                        config = json.load(f)
                    break
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

        async def do_send_code():
            try:
                sent = await client.send_code_request(phone)
                code_type = type(sent.type).__name__
                debug(f"Code sent via: {code_type}")
                return sent.phone_code_hash, code_type
            except FloodWaitError as e:
                wait = e.seconds
                debug(f"FloodWaitError: must wait {wait}s")
                raise Exception(f"flood_wait:{wait}")

        if command == "login":
            if not await client.is_user_authorized():
                try:
                    phone_code_hash, code_type = await do_send_code()
                    print(
                        json.dumps(
                            {
                                "status": "needs_code",
                                "phone": phone,
                                "phone_code_hash": phone_code_hash,
                                "code_type": code_type,
                            }
                        )
                    )
                except Exception as e:
                    msg = str(e)
                    if msg.startswith("flood_wait:"):
                        wait = int(msg.split(":")[1])
                        print(
                            json.dumps(
                                {"status": "error", "message": f"flood_wait:{wait}"}
                            )
                        )
                    else:
                        print(json.dumps({"status": "error", "message": msg}))
            else:
                print(json.dumps({"status": "authorized"}))

        elif command == "request_sms":
            # Strategy:
            # 1. Try ResendCodeRequest with the existing hash (moves to next delivery method: App -> SMS -> Call)
            # 2. If that fails (all methods exhausted), cancel and start completely fresh
            from telethon.tl.functions.auth import ResendCodeRequest, CancelCodeRequest

            phone_code_hash = command_obj.get("phoneCodeHash")
            try:
                result = await client(
                    ResendCodeRequest(
                        phone_number=phone, phone_code_hash=phone_code_hash
                    )
                )
                code_type = type(result.type).__name__
                debug(f"Resend code type: {code_type}")
                print(
                    json.dumps(
                        {
                            "status": "needs_code",
                            "phone": phone,
                            "phone_code_hash": result.phone_code_hash,
                            "code_type": code_type,
                        }
                    )
                )
            except Exception as e:
                debug(
                    f"ResendCodeRequest failed ({e}), cancelling and retrying fresh..."
                )
                # Cancel the current auth flow so we can start fresh
                try:
                    await client(
                        CancelCodeRequest(
                            phone_number=phone, phone_code_hash=phone_code_hash
                        )
                    )
                    debug("CancelCodeRequest succeeded")
                except Exception as ce:
                    debug(f"CancelCodeRequest also failed: {ce}")
                # Start a completely new code request
                try:
                    new_hash, new_type = await do_send_code()
                    debug(f"Fresh send_code_request type: {new_type}")
                    print(
                        json.dumps(
                            {
                                "status": "needs_code",
                                "phone": phone,
                                "phone_code_hash": new_hash,
                                "code_type": new_type,
                            }
                        )
                    )
                except Exception as e2:
                    print(json.dumps({"status": "error", "message": str(e2)}))

        elif command == "submit_code":
            code = command_obj.get("code")
            phone_code_hash = command_obj.get("phoneCodeHash")
            try:
                await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
                print(json.dumps({"status": "authorized"}))
            except Exception as e:
                print(json.dumps({"status": "error", "message": str(e)}))

        elif command == "qr_login":
            # QR Login: generate a QR token and return immediately.
            # The frontend will poll with "qr_check" to see if it was scanned.
            if await client.is_user_authorized():
                print(json.dumps({"status": "authorized"}))
            else:
                try:
                    result = await client(
                        ExportLoginTokenRequest(
                            api_id=int(api_id),
                            api_hash=api_hash,
                            except_ids=[],
                        )
                    )

                    if isinstance(result, LoginTokenSuccess):
                        debug("QR: Already authorized via token")
                        print(json.dumps({"status": "authorized"}))
                    elif isinstance(result, LoginTokenMigrateTo):
                        debug(f"QR: Need to migrate to DC{result.dc_id}")
                        await client._switch_dc(result.dc_id)
                        result2 = await client(
                            ImportLoginTokenRequest(token=result.token)
                        )
                        if isinstance(result2, LoginTokenSuccess):
                            print(json.dumps({"status": "authorized"}))
                        else:
                            print(
                                json.dumps(
                                    {
                                        "status": "error",
                                        "message": "Migration failed",
                                    }
                                )
                            )
                    elif isinstance(result, LoginToken):
                        token_b64 = (
                            base64.urlsafe_b64encode(result.token)
                            .decode("ascii")
                            .rstrip("=")
                        )
                        qr_url = f"tg://login?token={token_b64}"
                        debug(f"QR token generated: {qr_url[:50]}...")
                        # Return immediately so the frontend can show the QR
                        print(json.dumps({"status": "qr_pending", "qr_url": qr_url}))
                    else:
                        print(
                            json.dumps(
                                {
                                    "status": "error",
                                    "message": f"Unexpected result: {type(result).__name__}",
                                }
                            )
                        )
                except FloodWaitError as e:
                    print(
                        json.dumps(
                            {
                                "status": "error",
                                "message": f"flood_wait:{e.seconds}",
                            }
                        )
                    )
                except Exception as e:
                    debug(f"QR login error: {e}")
                    print(json.dumps({"status": "error", "message": str(e)}))

        elif command == "qr_check":
            # Check if QR was scanned (session authorized).
            # Only checks is_user_authorized() -- does NOT generate a new token
            # so the current QR stays valid.
            if await client.is_user_authorized():
                debug("QR check: authorized!")
                print(json.dumps({"status": "authorized"}))
            else:
                print(json.dumps({"status": "qr_pending"}))

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

                            # Strip Telegram Markdown decorators and trailing punctuation
                            # e.g. "__**M+ LALIGA TV HD:**__" -> "M+ LALIGA TV HD"
                            name = re.sub(
                                r"[_*`~|>]+", "", name
                            )  # remove markdown chars
                            name = name.strip(
                                " :-."
                            )  # strip trailing/leading punctuation
                            name = re.sub(r"\s+", " ", name).strip()

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
