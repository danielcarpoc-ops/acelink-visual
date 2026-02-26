#!/bin/bash
dns-sd -B _googlecast._tcp > out.txt &
PID=$!
sleep 4
kill $PID
cat out.txt
