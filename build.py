"""Builds MCdng from src/ in three forms:

  dist/MCdng.html   a single self-contained file that runs offline from file://
  dist/extension/   the same app as a Chrome and Edge extension, with the Save to MCdng button
  dist/web/         the same app as a web app to publish (GitHub Pages) and add to the iPad's Home Screen,
                    with a service worker that keeps it working offline

Usage: python3 build.py
"""

import base64
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
OUT = DIST / "MCdng.html"
EXTENSION = DIST / "extension"
WEB = DIST / "web"
FONTS = ROOT / "vendor" / "fonts"
VERSION = "2.0.0"

MANIFEST = {
    "manifest_version": 3,
    "name": "MCdng",
    "version": VERSION,
    "description": "Qualitative coding for literature reviews. Save to MCdng adds the PDF of the article you are reading to your project.",
    "action": {"default_title": "Save to MCdng", "default_popup": "popup.html",
               "default_icon": {str(n): f"icons/icon-{n}.png" for n in (16, 32, 48)}},
    "icons": {str(n): f"icons/icon-{n}.png" for n in (16, 32, 48, 128)},
    "background": {"service_worker": "background.js"},
    # scripting reads the article page and downloads its PDF with the page's own access; tabs finds the MCdng tab.
    "permissions": ["scripting", "tabs"],
    "host_permissions": ["<all_urls>"],
}

# Unicode ranges of the Latin and Latin Extended subsets, as published with the fonts.
LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"

# (family, style, file prefix): every face is a variable font with a weight axis, in two subsets.
FACES = [
    ("Figtree", "normal", "figtree-{subset}-wght-normal"),
    ("Source Serif 4", "normal", "source-serif-4-{subset}-wght-normal"),
    ("Source Serif 4", "italic", "source-serif-4-{subset}-wght-italic"),
]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def as_global(module_source: str, name: str) -> str:
    """Replaces the trailing `export {a as b, ...}` of an ES module with `globalThis.<name> = {b: a, ...}`."""
    match = re.search(r"export\s*\{([^}]*)\};?\s*$", module_source)
    if not match:
        raise SystemExit(f"No trailing export statement found for {name}")
    pairs = []
    for part in match.group(1).split(","):
        local, _, exported = part.strip().partition(" as ")
        pairs.append(f"{exported.strip()}:{local.strip()}" if exported else local.strip())
    return f"{module_source[:match.start()]}globalThis.{name}={{{','.join(pairs)}}};"


def font_faces() -> str:
    """Embeds the fonts as @font-face rules with data URIs, so the file stays self-contained."""
    rules = []
    for family, style, prefix in FACES:
        for subset, unicode_range in (("latin", LATIN), ("latin-ext", LATIN_EXT)):
            data = base64.b64encode((FONTS / f"{prefix.format(subset=subset)}.woff2").read_bytes()).decode()
            rules.append(
                f"@font-face{{font-family:'{family}';font-style:{style};font-weight:300 900;font-display:block;"
                f"src:url(data:font/woff2;base64,{data}) format('woff2');unicode-range:{unicode_range};}}")
    return "\n".join(rules)


def source(spec: str) -> str:
    """The content a placeholder stands for: the fonts, the app's modules joined in name order, or a file."""
    if spec == "fonts":
        return font_faces()
    if spec == "app":
        return "\n".join(read(f) for f in sorted((SRC / "js").glob("*.js")))
    path, _, name = spec.partition(" as ")
    content = read(ROOT / path if path.startswith("vendor/") else SRC / path)
    return as_global(content, name.strip()) if name else content


def inline(match: re.Match) -> str:
    spec = match.group(1).strip()
    content = source(spec)
    if re.search(r"</(script|style)", content, flags=re.I):
        raise SystemExit(f"{spec} contains a closing tag and cannot be inlined")
    return content


def script_file(spec: str) -> str:
    """The file name a script gets in the extension: app.js, pdf.worker.min.js, pdf.min.js."""
    return "app.js" if spec == "app" else Path(spec.partition(" as ")[0]).name.replace(".mjs", ".js")


def build_file() -> None:
    html = re.sub(r"/\* @inline ([^*]+?) \*/", inline, read(SRC / "template.html"))
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.1f} MB)")


def build_extension() -> None:
    """Extension pages may not run inline scripts, so each script becomes a file of its own; styles stay inline."""
    if EXTENSION.exists():
        shutil.rmtree(EXTENSION)
    (EXTENSION / "icons").mkdir(parents=True)
    (EXTENSION / "licenses").mkdir()

    def external(match: re.Match) -> str:
        spec = match.group(1).strip()
        (EXTENSION / script_file(spec)).write_text(source(spec), encoding="utf-8")
        return f'<script type="module" src="{script_file(spec)}"></script>'

    html = read(SRC / "template.html")
    # The message for browsers too old to start MCdng is an inline script, which extensions may not run; the
    # extension only runs in Chrome and Edge anyway.
    html = re.sub(r'<!-- A browser too old.*?</script>\n', '', html, count=1, flags=re.S)
    html = re.sub(r'<script type="module">\s*/\* @inline ([^*]+?) \*/\s*</script>', external, html)
    html = re.sub(r"/\* @inline ([^*]+?) \*/", inline, html)
    (EXTENSION / "app.html").write_text(html, encoding="utf-8")
    for name in ("background.js", "popup.html", "popup.js", "popup.css"):
        shutil.copy(SRC / "extension" / name, EXTENSION / name)
    for icon in (SRC / "extension" / "icons").glob("*.png"):
        shutil.copy(icon, EXTENSION / "icons" / icon.name)
    shutil.copy(ROOT / "vendor" / "pdfjs" / "LICENSE", EXTENSION / "licenses" / "pdfjs-LICENSE.txt")
    for license in FONTS.glob("LICENSE-*.txt"):
        shutil.copy(license, EXTENSION / "licenses" / license.name)
    (EXTENSION / "manifest.json").write_text(json.dumps(MANIFEST, indent=2), encoding="utf-8")
    print(f"Wrote {EXTENSION.relative_to(ROOT)}/ ({sum(f.stat().st_size for f in EXTENSION.rglob('*') if f.is_file()) / 1e6:.1f} MB)")


# Added to the page of the web app: the manifest, the Home Screen icon and name, and the service worker.
WEB_HEAD = """<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="MCdng">
<meta name="theme-color" content="#f6f6f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f0f0f" media="(prefers-color-scheme: dark)">
"""
WEB_SCRIPT = """<script>
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js');
</script>
"""


def build_web() -> None:
    if WEB.exists():
        shutil.rmtree(WEB)
    (WEB / "icons").mkdir(parents=True)
    html = OUT.read_text(encoding="utf-8")
    html = html.replace("<title>MCdng</title>", f"<title>MCdng</title>\n{WEB_HEAD}", 1).replace("</body>", f"{WEB_SCRIPT}</body>", 1)
    (WEB / "index.html").write_text(html, encoding="utf-8")
    # The cache name changes with the page, so a new version replaces the old one on the device.
    digest = hashlib.sha256(html.encode()).hexdigest()[:12]
    (WEB / "sw.js").write_text(read(SRC / "web" / "sw.js").replace("__VERSION__", f"{VERSION}-{digest}"), encoding="utf-8")
    shutil.copy(SRC / "web" / "manifest.webmanifest", WEB / "manifest.webmanifest")
    for icon in (SRC / "web" / "icons").glob("*.png"):
        shutil.copy(icon, WEB / "icons" / icon.name)
    print(f"Wrote {WEB.relative_to(ROOT)}/ ({sum(f.stat().st_size for f in WEB.rglob('*') if f.is_file()) / 1e6:.1f} MB)")


def main() -> None:
    DIST.mkdir(exist_ok=True)
    build_file()
    build_extension()
    build_web()


if __name__ == "__main__":
    main()
