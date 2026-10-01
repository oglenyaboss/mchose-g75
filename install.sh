#!/bin/bash
# Установка always-on коллектора под launchd (ADR 0003).
# Старт при логине, автоперезапуск (KeepAlive), пауза ⌃⌥K.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p corpus
chmod 700 corpus
touch corpus/personal.log
chmod 600 corpus/personal.log
touch corpus/keylog.err
grep -qxF 'corpus/' .gitignore 2>/dev/null || echo 'corpus/' >> .gitignore

NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.mchose.keylog.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mchose.keylog</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${PWD}/keylog.cjs</string>
  </array>
  <key>WorkingDirectory</key><string>${PWD}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>${PWD}/corpus/keylog.err</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 1
if launchctl list | grep -q mchose; then
  echo "OK: коллектор запущен. Пауза — ⌃⌥K, лог — corpus/personal.log"
  echo "Проверь глазами: corpus/keylog.err не должен расти (tapCreate failed)"
else
  echo "FAIL: launchd не поднял агент, смотри corpus/keylog.err" >&2
  exit 1
fi
