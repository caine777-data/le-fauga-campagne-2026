#!/usr/bin/env python3
"""build_setup.py : fabrique un setup.exe en local, sortie minuscule.

Étapes : (1) PyInstaller emballe l'appli Python en .exe ; (2) Inno Setup (ISCC)
ou, à défaut, NSIS (makensis) fabrique l'installateur setup.exe.
Le journal complet va dans build/setup-log.txt ; à l'écran : un résumé, ou les
lignes d'erreur utiles en cas d'échec. Claude n'a jamais à lire le journal entier.

    python build_setup.py --entree app.py --nom MonAppli [--version 1.0.0]
                          [--icone app.ico] [--fenetre] [--onedir]
                          [--donnees "assets;assets"] [--editeur "Nom"]
                          [--sans-installeur] [--verifier]

--verifier : dit seulement ce qui est installé (Python, PyInstaller, ISCC, makensis).

Prérequis Windows : `pip install pyinstaller`, puis `winget install JRSoftware.InnoSetup`
(ou `winget install NSIS.NSIS`). Un .iss / .nsi existant à la racine est réutilisé tel quel.
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
BUILD = ROOT / "build"
LOG = BUILD / "setup-log.txt"
ERR = re.compile(r"(error|erreur|exception|traceback|failed|échec|not found|introuvable|"
                 r"modulenotfound|importerror|cannot|unable)", re.I)

ISCC_PATHS = [
    r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    r"C:\Program Files\Inno Setup 6\ISCC.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"),
]
NSIS_PATHS = [r"C:\Program Files (x86)\NSIS\makensis.exe", r"C:\Program Files\NSIS\makensis.exe"]


def find(name: str, extra: list[str]) -> str | None:
    return shutil.which(name) or next((p for p in extra if os.path.isfile(p)), None)


def step(title: str, cmd: list[str]) -> None:
    BUILD.mkdir(exist_ok=True)
    with open(LOG, "a", encoding="utf-8", errors="replace") as log:
        log.write(f"\n===== {title} =====\n{' '.join(cmd)}\n")
        log.flush()
        res = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=ROOT)
    if res.returncode != 0:
        text = LOG.read_text(encoding="utf-8", errors="replace").splitlines()
        start = max(i for i, l in enumerate(text) if l.startswith("===== "))
        part = text[start:]
        hits = [l for l in part if ERR.search(l)]
        print(f"ÉCHEC {title} (code {res.returncode}). Lignes utiles :")
        print("\n".join((hits[-12:] or part[-12:])))
        print(f"(journal complet : {LOG} ; le lire par Grep, pas en entier)")
        sys.exit(res.returncode)
    print(f"OK {title}")


def iss_script(a, app_dir: Path, exe: str) -> Path:
    path = BUILD / f"{a.nom}.iss"
    src = f"{app_dir}\\*" if a.onedir else str(app_dir / exe)
    flags = "ignoreversion recursesubdirs createallsubdirs" if a.onedir else "ignoreversion"
    icon = f"SetupIconFile={Path(a.icone).resolve()}\n" if a.icone else ""
    path.write_text(f"""[Setup]
AppName={a.nom}
AppVersion={a.version}
AppPublisher={a.editeur}
DefaultDirName={{autopf}}\\{a.nom}
DefaultGroupName={a.nom}
OutputDir={(ROOT / 'dist').resolve()}
OutputBaseFilename={a.nom}-{a.version}-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequiredOverridesAllowed=dialog
{icon}
[Languages]
Name: "french"; MessagesFile: "compiler:Languages\\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{{cm:CreateDesktopIcon}}"; Flags: unchecked

[Files]
Source: "{src}"; DestDir: "{{app}}"; Flags: {flags}

[Icons]
Name: "{{group}}\\{a.nom}"; Filename: "{{app}}\\{exe}"
Name: "{{autodesktop}}\\{a.nom}"; Filename: "{{app}}\\{exe}"; Tasks: desktopicon

[Run]
Filename: "{{app}}\\{exe}"; Description: "Lancer {a.nom}"; Flags: nowait postinstall skipifsilent
""", encoding="utf-8")
    return path


def nsi_script(a, app_dir: Path, exe: str) -> Path:
    path = BUILD / f"{a.nom}.nsi"
    files = f'File /r "{app_dir}\\*"' if a.onedir else f'File "{app_dir / exe}"'
    path.write_text(f"""Unicode true
Name "{a.nom}"
OutFile "{(ROOT / 'dist' / f'{a.nom}-{a.version}-setup.exe').resolve()}"
InstallDir "$PROGRAMFILES64\\{a.nom}"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"
Section
  SetOutPath "$INSTDIR"
  {files}
  CreateShortcut "$SMPROGRAMS\\{a.nom}.lnk" "$INSTDIR\\{exe}"
  WriteUninstaller "$INSTDIR\\Desinstaller.exe"
SectionEnd
Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\\{a.nom}.lnk"
SectionEnd
""", encoding="utf-8")
    return path


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--entree", help="script Python principal (ex. app.py)")
    p.add_argument("--nom", help="nom de l'application (sans espaces de préférence)")
    p.add_argument("--version", default="1.0.0")
    p.add_argument("--editeur", default="")
    p.add_argument("--icone")
    p.add_argument("--fenetre", action="store_true", help="appli graphique : pas de console")
    p.add_argument("--onedir", action="store_true", help="dossier au lieu d'un seul .exe (démarre plus vite)")
    p.add_argument("--donnees", action="append", default=[], help='"source;destination" (Windows) ou "source:destination"')
    p.add_argument("--sans-installeur", action="store_true")
    p.add_argument("--verifier", action="store_true")
    a = p.parse_args()

    iscc, nsis = find("iscc", ISCC_PATHS), find("makensis", NSIS_PATHS)
    has_pyi = shutil.which("pyinstaller") or subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--version"], capture_output=True).returncode == 0
    if a.verifier:
        print(f"Python {sys.version.split()[0]} | PyInstaller {'oui' if has_pyi else 'NON (pip install pyinstaller)'}"
              f" | Inno Setup {'oui' if iscc else 'non'} | NSIS {'oui' if nsis else 'non'}"
              f"{'' if (iscc or nsis) else ' → winget install JRSoftware.InnoSetup'}")
        return
    if not a.entree or not a.nom:
        p.error("--entree et --nom sont requis")
    if not has_pyi:
        print("ERREUR : PyInstaller absent. `pip install pyinstaller` puis relancer.")
        sys.exit(1)

    LOG.parent.mkdir(exist_ok=True)
    LOG.write_text("", encoding="utf-8")
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN",
           "--name", a.nom, "--distpath", str(ROOT / "dist"), "--workpath", str(BUILD / "pyinstaller"),
           "--specpath", str(BUILD)]
    cmd += ["--onedir"] if a.onedir else ["--onefile"]
    if a.fenetre:
        cmd.append("--windowed")
    if a.icone:
        cmd += ["--icon", str(Path(a.icone).resolve())]
    for d in a.donnees:
        src, _, dst = d.partition(";") if ";" in d else d.rpartition(":")
        cmd += ["--add-data", f"{Path(src).resolve()}{os.pathsep}{dst or '.'}"]
    cmd.append(a.entree)
    step("PyInstaller", cmd)

    exe = a.nom + (".exe" if os.name == "nt" else "")
    app_dir = (ROOT / "dist" / a.nom) if a.onedir else (ROOT / "dist")
    if a.sans_installeur:
        print(f"FINI : {app_dir / exe}")
        return

    own_iss = next(iter(ROOT.glob("*.iss")), None)
    own_nsi = next(iter(ROOT.glob("*.nsi")), None)
    if iscc:
        step("Inno Setup", [iscc, "/Q", str(own_iss or iss_script(a, app_dir, exe))])
    elif nsis:
        step("NSIS", [nsis, "-V2", str(own_nsi or nsi_script(a, app_dir, exe))])
    else:
        print(f"Pas d'Inno Setup ni de NSIS : l'exe est prêt ({app_dir / exe}), mais pas l'installateur. "
              "`winget install JRSoftware.InnoSetup` puis relancer.")
        return
    setups = sorted((ROOT / "dist").glob("*setup*.exe"), key=lambda f: f.stat().st_mtime)
    if setups:
        s = setups[-1]
        print(f"FINI : {s} ({s.stat().st_size / 1e6:.1f} Mo)")
    else:
        print(f"Installateur compilé, mais introuvable dans dist/ (voir {LOG})")


if __name__ == "__main__":
    main()
