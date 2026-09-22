#!/usr/bin/env python3
"""
Packages each ERP module's source (backend controllers/services/dto +
matching frontend app route + components) into a versioned zip under
the user's local "ماژول ها" folder. Run this after any change to a
module's code so its folder gets a fresh vN zip; keeps only the 5
most recent zips per module.

Usage:
  python3 scripts/package-modules.py                 # package every mapped module (bump version if changed)
  python3 scripts/package-modules.py contracts hr     # package only these modules
"""
import hashlib
import os
import shutil
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_SRC = os.path.join(REPO, "apps/backend-core/src")
FRONTEND_APP = os.path.join(REPO, "apps/web-panel/src/app/(app)")
FRONTEND_COMPONENTS = os.path.join(REPO, "apps/web-panel/src/components")
DEST_ROOT = "/Users/m/Documents/شرکت اکسیر تجارت  امین/exir erp/ماژول ها"

# module code -> (backend dir name(s), frontend app route dir, frontend components dir)
MODULES = {
    "accounting": (["accounting"], "accounting", "accounting"),
    "after-sales-service": (["after-sales"], "after-sales", "after-sales"),
    "automation": (["automation"], "automation", "automation"),
    "booking": (["booking"], "booking", "booking"),
    "checks": (["checks"], "checks", "checks"),
    "contracts": (["contracts"], "contracts", "contracts"),
    "crm": (["crm"], "crm", "crm"),
    "daily-checklist": (["daily-checklist"], "dashboard", "dashboard"),
    "events": (["events"], "events", "events"),
    "fleet": (["fleet"], "fleet", "fleet"),
    "forms": (["forms"], "forms", "forms"),
    "hr": (["hr"], "hr", "hr"),
    "marketing": (["marketing"], "marketing", "marketing"),
    "mentoring": (["mentoring"], "mentoring", "mentoring"),
    "online-store": (["online-store"], "online-store", "online-store"),
    "production": (["production"], "production", "production"),
    "projects": (["projects"], "projects", "projects"),
    "purchasing": (["purchasing"], "purchasing", "purchasing"),
    "qr-code": (["qr-code"], "qr-code", "qr-code"),
    "quality-control": (["quality-control"], "quality-control", None),
    "ration-lab": (["ration-lab"], "ration-lab", None),
    "recruitment": (["recruitment"], "recruitment", "recruitment"),
    "referral-marketing": (["referral-marketing", "tenants"], "referral-marketing", "referral-marketing"),
    "reports": (["reports"], "reports", "reports"),
    "sales": (["sales"], "sales", "sales"),
    "tasks": (["tasks"], "tasks", None),
    "warehouse": (["warehouse"], "warehouse", "warehouse"),
    "warranty": (["warranty"], "warranty", "warranty"),
    "voip": (["voip"], "settings/voip", None),
    "mcp": (["mcp"], None, None),
    "webhooks": (["webhooks"], None, None),
    "api-access": (["api-keys"], "settings/api", None),
    "currency-exchange": (["exchange-rates"], "settings/currencies", None),
    "checks-supplier-risk": (["crm"], None, None),  # supplier-risk lives inside crm — see crm package
}

SKIP_DIR_NAMES = {"node_modules", "__pycache__", ".next"}


def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
        for f in filenames:
            yield os.path.join(dirpath, f)


def content_hash(paths):
    h = hashlib.sha256()
    for base in paths:
        if not base or not os.path.exists(base):
            continue
        for fp in sorted(iter_files(base)):
            h.update(fp.encode())
            with open(fp, "rb") as fh:
                h.update(fh.read())
    return h.hexdigest()


def package_module(code):
    backend_dirs, app_dir, comp_dir = MODULES[code]
    sources = []
    for d in backend_dirs:
        p = os.path.join(BACKEND_SRC, d)
        if os.path.isdir(p):
            sources.append(("apps/backend-core/src/" + d, p))
    if app_dir:
        p = os.path.join(FRONTEND_APP, app_dir)
        if os.path.isdir(p):
            sources.append(("apps/web-panel/src/app/(app)/" + app_dir, p))
    if comp_dir:
        p = os.path.join(FRONTEND_COMPONENTS, comp_dir)
        if os.path.isdir(p):
            sources.append(("apps/web-panel/src/components/" + comp_dir, p))

    if not sources:
        print(f"[skip] {code}: no source directories found")
        return

    dest_dir = os.path.join(DEST_ROOT, code)
    os.makedirs(dest_dir, exist_ok=True)
    hash_file = os.path.join(dest_dir, ".content_hash")
    version_file = os.path.join(dest_dir, ".version")

    current_hash = content_hash([p for _, p in sources])
    prev_hash = open(hash_file).read().strip() if os.path.exists(hash_file) else None
    version = int(open(version_file).read().strip()) if os.path.exists(version_file) else 0

    if current_hash == prev_hash:
        print(f"[unchanged] {code}: still v{version}")
        return

    version += 1
    zip_path = os.path.join(dest_dir, f"v{version}_{code}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for arc_prefix, base in sources:
            for fp in sorted(iter_files(base)):
                arcname = os.path.join(arc_prefix, os.path.relpath(fp, base))
                zf.write(fp, arcname)

    with open(hash_file, "w") as f:
        f.write(current_hash)
    with open(version_file, "w") as f:
        f.write(str(version))

    # keep only the 5 most recent versioned zips
    zips = sorted(
        (f for f in os.listdir(dest_dir) if f.startswith("v") and f.endswith(".zip")),
        key=lambda name: int(name.split("_")[0][1:]),
    )
    for old in zips[:-5]:
        os.remove(os.path.join(dest_dir, old))

    print(f"[packaged] {code}: v{version} -> {zip_path}")


def main():
    codes = sys.argv[1:] or [c for c in MODULES if c != "checks-supplier-risk"]
    os.makedirs(DEST_ROOT, exist_ok=True)
    for code in codes:
        if code not in MODULES:
            print(f"[unknown module] {code}")
            continue
        package_module(code)


if __name__ == "__main__":
    main()
