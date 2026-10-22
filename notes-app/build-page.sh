#!/bin/bash
# Assemble the page (with embedded PDF fonts) into the app's assets
cd "$(dirname "$0")"
OUT=app/src/main/assets/index.html
{ cat src/page.html
  printf '<script>window.MARGIN_FONT_R="%s";window.MARGIN_FONT_B="%s";</script>\n' "$(cat src/font-Regular.b64)" "$(cat src/font-Bold.b64)"
  echo '<script>'; cat src/lib.js; echo; cat src/ui.js; echo '</script>'; } > "$OUT"
echo "built $OUT ($(wc -c < "$OUT") bytes)"
