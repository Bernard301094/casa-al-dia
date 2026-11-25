#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 5 ]]; then
  printf 'Usage: %s BUILD_TOOLS ANDROID_JAR KEYSTORE PASSWORD_FILE OUTPUT_APK\n' "$0" >&2
  exit 2
fi

build_tools=$1
android_jar=$2
keystore=$3
password_file=$4
output=$5
project=$(cd -- "$(dirname -- "$0")" && pwd)
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/classes" "$stage/dex"
"$build_tools/aapt2" compile --dir "$project/res" -o "$stage/resources.zip"
"$build_tools/aapt2" link -I "$android_jar" --manifest "$project/AndroidManifest.xml" \
  -o "$stage/unsigned.apk" "$stage/resources.zip"
source_file="$project/src/com/casaaldia/app/MainActivity.java"
if [[ -n ${CASA_ECJ_JAR:-} ]]; then
  java -jar "$CASA_ECJ_JAR" -8 -proc:none -bootclasspath "$android_jar" -d "$stage/classes" "$source_file"
else
  javac -source 8 -target 8 -bootclasspath "$android_jar" -d "$stage/classes" "$source_file"
fi
(cd "$stage/classes" && zip -qr "$stage/classes.jar" .)
"$build_tools/d8" --release --min-api 26 --lib "$android_jar" --output "$stage/dex" "$stage/classes.jar"
(cd "$stage/dex" && zip -q "$stage/unsigned.apk" classes.dex)
"$build_tools/zipalign" -f 4 "$stage/unsigned.apk" "$stage/aligned.apk"
"$build_tools/apksigner" sign --ks "$keystore" --ks-key-alias casa-al-dia \
  --ks-pass "file:$password_file" --out "$output" "$stage/aligned.apk"
"$build_tools/apksigner" verify --verbose --print-certs "$output"
"$build_tools/zipalign" -c 4 "$output"
