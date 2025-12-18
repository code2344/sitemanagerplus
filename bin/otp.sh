#!/usr/bin/env bash
# Offline OTP generator for SiteManager+ resets
# Usage: ./bin/otp.sh <APP_SECRET>
# The OTP is valid for the current minute and last 4 minutes.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <APP_SECRET>" >&2
  exit 1
fi

SECRET="$1"

# Compute 6-digit OTP using HMAC-SHA256(secret, minute_counter)
# minute_counter = floor(epoch / 60)

minute_counter=$(($(date +%s)/60))

function gen_code() {
  local counter="$1"
  # Create 8-byte big-endian counter
  python3 - <<'PY' "$counter" "$SECRET"
import sys, hmac, hashlib
counter = int(sys.argv[1])
secret = sys.argv[2].encode()
# 8-byte big-endian buffer
b = counter.to_bytes(8, 'big')
d = hmac.new(secret, b, hashlib.sha256).digest()
code = int.from_bytes(d[:4], 'big') % 1000000
print(str(code).zfill(6))
PY
}

echo "Valid OTPs (current and last 4 minutes):"
for i in 0 1 2 3 4; do
  c=$((minute_counter - i))
  printf "- %s\n" "$(gen_code "$c")"
done
