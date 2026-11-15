#!/usr/bin/env python3
"""media.py : travail image / vidéo / audio en local, sortie minuscule.

Principe : ffmpeg fait le travail, Claude ne lit que 1 à 3 lignes de résultat
(ou UNE image d'aperçu réduite). Les journaux complets vont dans un fichier.

    python media.py info      FICHIER...
    python media.py apercu    FICHIER [--max 768] [--t 5] [-o sortie.jpg]
    python media.py planche   VIDEO [--n 12] [--cols 4] [--largeur 1536] [-o planche.jpg]
    python media.py couper    ENTREE DEBUT FIN SORTIE [--exact]
    python media.py assembler SORTIE ENTREE1 ENTREE2 ...
    python media.py compresser ENTREE SORTIE [--crf 28] [--max 1920] [--audio 128k]
    python media.py reduire   DOSSIER|IMAGE... [--max 1600] [--qualite 85] [--dest dossier]
    python media.py extraire-audio VIDEO SORTIE.(mp3|wav|m4a)
    python media.py gif       VIDEO SORTIE.gif [--debut 0] [--duree 4] [--largeur 480] [--fps 12]
    python media.py ffmpeg    ARGS...        (ffmpeg brut, silencieux, journal à part)

Fonctionne sous Windows, macOS et Linux. Requiert ffmpeg et ffprobe dans le PATH
(Windows : `winget install Gyan.FFmpeg`).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LOG = Path(tempfile.gettempdir()) / "media-py-dernier.log"
IMAGES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".heic"}


def die(msg: str, code: int = 1) -> None:
    print(f"ERREUR : {msg}")
    sys.exit(code)


def need(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        die(f"{tool} introuvable. Installer ffmpeg (Windows : winget install Gyan.FFmpeg ; "
            "macOS : brew install ffmpeg ; Linux : apt install ffmpeg).")
    return path


def human(n: float) -> str:
    for unit in ("o", "Ko", "Mo", "Go"):
        if n < 1024 or unit == "Go":
            return f"{n:.0f} {unit}" if unit == "o" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


def run_ffmpeg(args: list[str]) -> None:
    """ffmpeg sans bannière ni progression ; en cas d'échec, 8 lignes d'erreur max."""
    cmd = [need("ffmpeg"), "-hide_banner", "-nostats", "-loglevel", "error", "-y", *args]
    with open(LOG, "w", encoding="utf-8", errors="replace") as log:
        log.write(" ".join(cmd) + "\n\n")
        log.flush()
        res = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT)
    if res.returncode != 0:
        lines = LOG.read_text(encoding="utf-8", errors="replace").strip().splitlines()[2:]
        print("ERREUR ffmpeg (code %d) :" % res.returncode)
        print("\n".join(lines[-8:]))
        print(f"(journal complet : {LOG})")
        sys.exit(res.returncode)


def probe(path: str) -> dict:
    out = subprocess.run(
        [need("ffprobe"), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, text=True, errors="replace",
    )
    if out.returncode != 0:
        die(f"ffprobe ne lit pas {path} : {out.stderr.strip()[:300]}")
    return json.loads(out.stdout or "{}")


def duration(path: str) -> float:
    try:
        return float(probe(path).get("format", {}).get("duration", 0) or 0)
    except ValueError:
        return 0.0


def fmt_t(s: float) -> str:
    m, s = divmod(s, 60)
    h, m = divmod(int(m), 60)
    return f"{h}:{m:02d}:{s:05.2f}" if h else f"{m}:{s:05.2f}"


def done(out: str, extra: str = "") -> None:
    size = human(os.path.getsize(out)) if os.path.exists(out) else "?"
    print(f"OK {out} ({size}){' ' + extra if extra else ''}")


# ── commandes ────────────────────────────────────────────────────────────────

def cmd_info(a) -> None:
    for f in a.fichiers:
        d = probe(f)
        fmt = d.get("format", {})
        parts = [Path(f).name, human(float(fmt.get("size", 0) or 0))]
        dur = float(fmt.get("duration", 0) or 0)
        if dur and Path(f).suffix.lower() not in IMAGES:
            parts.append(fmt_t(dur))
        for s in d.get("streams", []):
            kind = s.get("codec_type")
            if kind == "video" and Path(f).suffix.lower() in IMAGES:
                parts.append(f"{s.get('codec_name')} {s.get('width')}x{s.get('height')}")
            elif kind == "video":
                fps = s.get("avg_frame_rate", "0/1")
                try:
                    num, den = fps.split("/")
                    fps = f"{float(num) / float(den):.3g} i/s" if float(den) else ""
                except ValueError:
                    fps = ""
                rot = ""
                for sd in s.get("side_data_list", []) or []:
                    if "rotation" in sd:
                        rot = f" rot{sd['rotation']}"
                parts.append(f"{s.get('codec_name')} {s.get('width')}x{s.get('height')}{rot} {fps}".strip())
            elif kind == "audio":
                parts.append(f"{s.get('codec_name')} {s.get('sample_rate')}Hz {s.get('channels')}ch")
            elif kind == "subtitle":
                parts.append(f"sous-titres {s.get('codec_name')}")
        print(" | ".join(p for p in parts if p))


def cmd_apercu(a) -> None:
    src = a.fichier
    out = a.o or str(Path(tempfile.gettempdir()) / f"apercu-{Path(src).stem}.jpg")
    scale = f"scale='min({a.max},iw)':'min({a.max},ih)':force_original_aspect_ratio=decrease"
    args = []
    if Path(src).suffix.lower() not in IMAGES:
        args += ["-ss", str(a.t)]
    args += ["-i", src, "-frames:v", "1", "-vf", scale, "-q:v", "4", out]
    run_ffmpeg(args)
    done(out, f"(≤ {a.max}px : lire CE fichier, pas l'original)")


def cmd_planche(a) -> None:
    src = a.video
    dur = duration(src)
    if dur <= 0:
        die("durée inconnue : utiliser `apercu --t` à la place")
    n, cols = a.n, a.cols
    rows = (n + cols - 1) // cols
    tile_w = max(160, a.largeur // cols)
    tmp = Path(tempfile.mkdtemp(prefix="planche-"))
    step = dur / (n + 1)
    for i in range(n):
        t = step * (i + 1)
        draw = (
            "drawtext=text='%s':x=6:y=6:fontsize=%d:fontcolor=white:box=1:boxcolor=black@0.6"
            % (fmt_t(t).replace(":", r"\:"), max(12, tile_w // 14))
        )
        vf = f"scale={tile_w}:-2,{draw}"
        try:
            run_ffmpeg(["-ss", f"{t:.2f}", "-i", src, "-frames:v", "1", "-vf", vf, "-q:v", "5",
                        str(tmp / f"{i:03d}.jpg")])
        except SystemExit:
            # police absente (drawtext) : sans horodatage
            run_ffmpeg(["-ss", f"{t:.2f}", "-i", src, "-frames:v", "1", "-vf", f"scale={tile_w}:-2",
                        "-q:v", "5", str(tmp / f"{i:03d}.jpg")])
    out = a.o or str(Path(tempfile.gettempdir()) / f"planche-{Path(src).stem}.jpg")
    run_ffmpeg(["-framerate", "1", "-i", str(tmp / "%03d.jpg"),
                "-vf", f"tile={cols}x{rows}:padding=4:color=black", "-frames:v", "1", "-q:v", "4", out])
    shutil.rmtree(tmp, ignore_errors=True)
    done(out, f"{n} vignettes toutes les {step:.1f} s, en UNE image")


def cmd_couper(a) -> None:
    if a.exact:
        run_ffmpeg(["-i", a.entree, "-ss", a.debut, "-to", a.fin, "-c:v", "libx264", "-crf", "18",
                    "-preset", "veryfast", "-c:a", "aac", a.sortie])
    else:
        run_ffmpeg(["-ss", a.debut, "-to", a.fin, "-i", a.entree, "-c", "copy",
                    "-avoid_negative_ts", "make_zero", a.sortie])
    done(a.sortie, fmt_t(duration(a.sortie)))


def cmd_assembler(a) -> None:
    lst = Path(tempfile.gettempdir()) / "media-py-concat.txt"
    lst.write_text("".join(f"file '{Path(p).resolve().as_posix()}'\n" for p in a.entrees), encoding="utf-8")
    try:
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", a.sortie])
    except SystemExit:
        print("Copie directe impossible (formats différents) : réencodage…")
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-c:v", "libx264", "-crf", "20",
                    "-preset", "veryfast", "-c:a", "aac", a.sortie])
    done(a.sortie, fmt_t(duration(a.sortie)))


def cmd_compresser(a) -> None:
    before = os.path.getsize(a.entree)
    vf = f"scale='min({a.max},iw)':-2"
    run_ffmpeg(["-i", a.entree, "-vf", vf, "-c:v", "libx264", "-crf", str(a.crf), "-preset", "medium",
                "-c:a", "aac", "-b:a", a.audio, "-movflags", "+faststart", a.sortie])
    after = os.path.getsize(a.sortie)
    done(a.sortie, f"{human(before)} → {human(after)} ({100 * after / max(before, 1):.0f} %)")


def cmd_reduire(a) -> None:
    files: list[Path] = []
    for p in map(Path, a.chemins):
        files += sorted(x for x in p.iterdir() if x.suffix.lower() in IMAGES) if p.is_dir() else [p]
    if not files:
        die("aucune image trouvée")
    dest = Path(a.dest) if a.dest else None
    if dest:
        dest.mkdir(parents=True, exist_ok=True)
    q = max(2, min(31, round(31 - a.qualite * 0.29)))
    total_in = total_out = 0
    for f in files:
        out = (dest / f.name) if dest else f.with_name(f"{f.stem}-{a.max}{f.suffix}")
        if out.suffix.lower() in {".heic", ".tif", ".tiff", ".bmp"}:
            out = out.with_suffix(".jpg")
        run_ffmpeg(["-i", str(f), "-vf",
                    f"scale='min({a.max},iw)':'min({a.max},ih)':force_original_aspect_ratio=decrease",
                    "-q:v", str(q), str(out)])
        total_in += f.stat().st_size
        total_out += out.stat().st_size
    print(f"OK {len(files)} image(s) ≤ {a.max}px : {human(total_in)} → {human(total_out)}"
          f"{' dans ' + str(dest) if dest else ''}")


def cmd_audio(a) -> None:
    ext = Path(a.sortie).suffix.lower()
    codec = {".mp3": ["-c:a", "libmp3lame", "-q:a", "2"], ".wav": ["-c:a", "pcm_s16le"],
             ".m4a": ["-c:a", "aac", "-b:a", "192k"]}.get(ext, [])
    run_ffmpeg(["-i", a.video, "-vn", *codec, a.sortie])
    done(a.sortie, fmt_t(duration(a.sortie)))


def cmd_gif(a) -> None:
    vf = (f"fps={a.fps},scale={a.largeur}:-1:flags=lanczos,split[s0][s1];"
          "[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer")
    run_ffmpeg(["-ss", str(a.debut), "-t", str(a.duree), "-i", a.video, "-vf", vf, "-loop", "0", a.sortie])
    done(a.sortie)


def cmd_ffmpeg(a) -> None:
    run_ffmpeg(a.args)
    out = a.args[-1] if a.args and not a.args[-1].startswith("-") else ""
    if out and os.path.exists(out):
        done(out)
    else:
        print(f"OK ffmpeg terminé (journal : {LOG})")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("info"); s.add_argument("fichiers", nargs="+"); s.set_defaults(f=cmd_info)
    s = sub.add_parser("apercu"); s.add_argument("fichier"); s.add_argument("--max", type=int, default=768)
    s.add_argument("--t", type=float, default=1.0); s.add_argument("-o"); s.set_defaults(f=cmd_apercu)
    s = sub.add_parser("planche"); s.add_argument("video"); s.add_argument("--n", type=int, default=12)
    s.add_argument("--cols", type=int, default=4); s.add_argument("--largeur", type=int, default=1536)
    s.add_argument("-o"); s.set_defaults(f=cmd_planche)
    s = sub.add_parser("couper"); [s.add_argument(x) for x in ("entree", "debut", "fin", "sortie")]
    s.add_argument("--exact", action="store_true"); s.set_defaults(f=cmd_couper)
    s = sub.add_parser("assembler"); s.add_argument("sortie"); s.add_argument("entrees", nargs="+")
    s.set_defaults(f=cmd_assembler)
    s = sub.add_parser("compresser"); s.add_argument("entree"); s.add_argument("sortie")
    s.add_argument("--crf", type=int, default=28); s.add_argument("--max", type=int, default=1920)
    s.add_argument("--audio", default="128k"); s.set_defaults(f=cmd_compresser)
    s = sub.add_parser("reduire"); s.add_argument("chemins", nargs="+"); s.add_argument("--max", type=int, default=1600)
    s.add_argument("--qualite", type=int, default=85); s.add_argument("--dest"); s.set_defaults(f=cmd_reduire)
    s = sub.add_parser("extraire-audio"); s.add_argument("video"); s.add_argument("sortie"); s.set_defaults(f=cmd_audio)
    s = sub.add_parser("gif"); s.add_argument("video"); s.add_argument("sortie")
    s.add_argument("--debut", type=float, default=0); s.add_argument("--duree", type=float, default=4)
    s.add_argument("--largeur", type=int, default=480); s.add_argument("--fps", type=int, default=12)
    s.set_defaults(f=cmd_gif)
    s = sub.add_parser("ffmpeg"); s.add_argument("args", nargs=argparse.REMAINDER); s.set_defaults(f=cmd_ffmpeg)

    if len(sys.argv) > 1 and sys.argv[1] == "ffmpeg":
        cmd_ffmpeg(argparse.Namespace(args=sys.argv[2:]))
        return
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
