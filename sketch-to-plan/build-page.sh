#!/bin/bash
# Assemble the single-file page from src/ into the app's assets
cd "$(dirname "$0")"
{ cat src/page.html; echo '<script>'; cat src/core.js; echo; cat src/export.js; echo; cat src/build.js; echo; cat src/export2.js; echo; cat src/ui.js; echo '</script>'; } > app/src/main/assets/index.html
echo "built app/src/main/assets/index.html ($(wc -c < app/src/main/assets/index.html) bytes)"
