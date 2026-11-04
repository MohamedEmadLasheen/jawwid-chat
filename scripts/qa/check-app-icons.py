#!/usr/bin/env python3
"""PD-56 PR-G guard: the app never ships Flutter's placeholder icon or launch image.

The App Store and Google Play reject the template artwork. This fails when:
  * any iOS AppIcon, Android launcher icon or iOS LaunchImage file is byte-identical to one
    of Flutter's template files (their sha256 below, recorded from main before PR-G);
  * the iOS 1024 marketing icon has an alpha channel (Apple refuses one);
  * the Android adaptive icon (mipmap-anydpi-v26/ic_launcher.xml) is missing.
Standard library only, so it runs wherever CI does.
"""
import glob
import hashlib
import os
import struct
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FLUTTER_TEMPLATE_SHA256 = {
    "19be171481dc71a0b2803ebcd01dd8b0c5fd5778dee34c0a3cabc948c225f24e",
    "3c34e1f298d0c9ea3455d46db6b7759c8211a49e9ec6e44b635fc5c87dfb4180",
    "41c7d42f6e61f8fe7f30b1ffa2256aecbc9682be06d18c4a3062043e1a2e547c",
    "4209a49e44a92ec40a327d3455eb1b1c153ee83d75de1c2be0a12ab18b2ff9de",
    "4d470bf22d5c17d84edc5f82516d1ba8a1c09559cd761cefb792f86d9f52b540",
    "5d7e5bdf01b93802bc973345b3a78c038907147625035952a08a115a563b7f81",
    "5dee24dc104ac76dc162e42ae0beb163d426bf365562ee28ba7b3ad368559a60",
    "6a7c8f0d703e3682108f9662f813302236240d3f8f638bb391e32bfb96055fef",
    "7770183009e914112de7d8ef1d235a6a30c5834424858e0d2f8253f6b8d31926",
    "7c61c42fc7b657d9cf314d32a4ec458f0647c3aaf360be1b9377857266ec2499",
    "836c918cb613249eba0483a6b02fa3df3c1c0a89a315ee4d3b88509b83c7ab73",
    "93ae7d494fad0fb30cbf3ae746a39c4bc7a0f8bbf87fbb587a3f3c01f3c5ce20",
    "a9b21eb6f4271385655a8771f76e29eef8c1107d7879cbcfc567e6619d1f716a",
    "b9ad02cf6576a04d1b6806ac02a2431481b448dd0c2e505ce25842d1f7c4730b",
    "c6e6d3b215ae744a9c391f4c4d44157eff5e739d6ad6c39f9bfa5df66dddd267",
    "c7c0c0189145e4e32a401c61c9bdc615754b0264e7afae24e834bb81049eaf81",
    "cab10a0d391ec5bc09ef50ce49e8ad401cee7ef03707ec0923a222c5c2b3d212",
    "e14aa40904929bf313fded22cf7e7ffcbf1d1aac4263b5ef1be8bfce650397aa",
    "e677d701ffe4af7bc2935098d6b3984cc9ab7ace573e6900955a5535b12410cf",
}
ICONS = [
    "ios/Runner/Assets.xcassets/AppIcon.appiconset/*.png",
    "ios/Runner/Assets.xcassets/LaunchImage.imageset/*.png",
    "android/app/src/main/res/mipmap-*/ic_launcher*.png",
]
MARKETING = "ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png"
ADAPTIVE = "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"


def png_has_alpha(path: str) -> bool:
    with open(path, "rb") as f:
        head = f.read(33)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    colour_type = head[25]
    return colour_type in (4, 6)  # grey+alpha, RGBA


def main() -> int:
    errors = []
    files = sorted({f for pattern in ICONS for f in glob.glob(os.path.join(ROOT, pattern))})
    if not files:
        errors.append("no app icon files found")
    for path in files:
        with open(path, "rb") as f:
            if hashlib.sha256(f.read()).hexdigest() in FLUTTER_TEMPLATE_SHA256:
                errors.append(f"{os.path.relpath(path, ROOT)} is Flutter's template artwork")
    marketing = os.path.join(ROOT, MARKETING)
    if not os.path.exists(marketing):
        errors.append(f"{MARKETING} is missing")
    elif png_has_alpha(marketing):
        errors.append(f"{MARKETING} has an alpha channel; App Store Connect refuses it")
    if not os.path.exists(os.path.join(ROOT, ADAPTIVE)):
        errors.append(f"{ADAPTIVE} is missing (the Android adaptive icon)")
    for e in errors:
        print(f"app-icons: {e}")
    if errors:
        print("Regenerate: scripts/brand/make-app-icons.py, then dart run flutter_launcher_icons "
              "and dart run flutter_native_splash:create (docs/mobile/store-builds.md).")
        return 1
    print(f"app-icons: {len(files)} icon files, none is Flutter's template; the 1024 icon is opaque")
    return 0


if __name__ == "__main__":
    sys.exit(main())
