#!/usr/bin/env sh
# The site is one file: the page (src/base.html) followed by the flight (src/survey.js).
set -e
cd "$(dirname "$0")"
cat src/base.html src/survey.js > index.html
echo "built index.html ($(wc -c < index.html) bytes)"
