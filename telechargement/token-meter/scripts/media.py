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
    python media.py galerie   DOSSIER|IMAGES... [-o galerie.jpg]   (variantes numérotées en UNE image)
    python media.py monter    PLAN.txt SORTIE.mp4   (montage automatique ; --aide pour le format du plan)
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


def cmd_galerie(a) -> None:
    files: list[Path] = []
    for p in map(Path, a.chemins):
        files += sorted(x for x in p.iterdir() if x.suffix.lower() in IMAGES) if p.is_dir() else [p]
    if not files:
        die("aucune image trouvée")
    files = files[: a.max_images]
    cols = a.cols or min(4, len(files))
    rows = (len(files) + cols - 1) // cols
    tile = max(160, a.largeur // cols)
    tmp = Path(tempfile.mkdtemp(prefix="galerie-"))
    for i, f in enumerate(files):
        base = f"scale={tile}:{tile}:force_original_aspect_ratio=decrease,pad={tile}:{tile}:(ow-iw)/2:(oh-ih)/2:color=black"
        label = f",drawtext=text='{i + 1}':x=8:y=8:fontsize={max(14, tile // 10)}:fontcolor=white:box=1:boxcolor=black@0.6"
        try:
            run_ffmpeg(["-i", str(f), "-frames:v", "1", "-vf", base + label, "-q:v", "5", str(tmp / f"{i:03d}.jpg")])
        except SystemExit:
            run_ffmpeg(["-i", str(f), "-frames:v", "1", "-vf", base, "-q:v", "5", str(tmp / f"{i:03d}.jpg")])
    out = a.o or str(Path(tempfile.gettempdir()) / "galerie.jpg")
    run_ffmpeg(["-framerate", "1", "-i", str(tmp / "%03d.jpg"), "-vf",
                f"tile={cols}x{rows}:padding=4:color=black", "-frames:v", "1", "-q:v", "4", out])
    shutil.rmtree(tmp, ignore_errors=True)
    done(out, f"{len(files)} images numérotées en UNE planche")
    for i, f in enumerate(files):
        print(f"  {i + 1} = {f}")


# ── montage automatique ──────────────────────────────────────────────────────

PLAN_AIDE = """Plan de montage (texte, une instruction par ligne, # pour commenter) :
  format 1080x1920            (9:16 Reel ; 1920x1080 YouTube ; 1080x1080 carré)
  fps 30
  fondu 0.4                   (fondu au noir en entrée/sortie de chaque plan, en s)
  musique piste.mp3 0.25      (boucle sous tout le film, baisse sous les voix)
  clip rush.mp4 0:05 0:12 [son 1.0] [texte "Titre"]
  image gravure.png 3 [zoom] [texte "Légende"]
  carton 2 "Texte plein écran"   (texte blanc sur fond noir)
"""


def font_opt() -> str:
    for f in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(f):
            return ":fontfile='" + f.replace(":", r"\:") + "'"
    return ""


def ff_path(p: Path) -> str:
    return str(p.resolve().as_posix()).replace(":", r"\:").replace("'", r"\'")


def parse_t(s: str) -> float:
    parts = [float(x) for x in s.replace(",", ".").split(":")]
    t = 0.0
    for x in parts:
        t = t * 60 + x
    return t


def parse_plan(text: str, base: Path) -> dict:
    import shlex
    plan = {"w": 1080, "h": 1920, "fps": 30, "fondu": 0.3, "musique": None, "segments": []}
    for n, line in enumerate(text.splitlines(), 1):
        line = line.split(" #")[0].strip()
        if not line or line.startswith("#"):
            continue
        tok = shlex.split(line, posix=True)
        k, args = tok[0].lower(), tok[1:]
        opts: dict = {}
        rest: list[str] = []
        i = 0
        while i < len(args):
            if args[i] == "texte" and i + 1 < len(args):
                opts["texte"] = args[i + 1]; i += 2
            elif args[i] == "son" and i + 1 < len(args):
                opts["son"] = float(args[i + 1]); i += 2
            elif args[i] == "zoom":
                opts["zoom"] = True; i += 1
            else:
                rest.append(args[i]); i += 1
        try:
            if k == "format":
                plan["w"], plan["h"] = map(int, rest[0].lower().split("x"))
            elif k == "fps":
                plan["fps"] = int(rest[0])
            elif k == "fondu":
                plan["fondu"] = float(rest[0])
            elif k == "musique":
                plan["musique"] = (base / rest[0], float(rest[1]) if len(rest) > 1 else 0.25)
            elif k == "clip":
                plan["segments"].append({"type": "clip", "src": base / rest[0], "debut": parse_t(rest[1]),
                                         "fin": parse_t(rest[2]), **opts})
            elif k == "image":
                plan["segments"].append({"type": "image", "src": base / rest[0], "duree": float(rest[1]), **opts})
            elif k == "carton":
                plan["segments"].append({"type": "carton", "duree": float(rest[0]),
                                         "texte": rest[1] if len(rest) > 1 else opts.get("texte", "")})
            else:
                die(f"ligne {n} : instruction inconnue « {k} »\n{PLAN_AIDE}")
        except (IndexError, ValueError):
            die(f"ligne {n} mal formée : {line}\n{PLAN_AIDE}")
    for s in plan["segments"]:
        if "src" in s and not s["src"].exists():
            die(f"fichier introuvable : {s['src']}")
    if not plan["segments"]:
        die("plan vide\n" + PLAN_AIDE)
    return plan


def has_audio(path: Path) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(str(path)).get("streams", []))


def cmd_monter(a) -> None:
    if a.aide:
        print(PLAN_AIDE); return
    plan_path = Path(a.plan)
    plan = parse_plan(plan_path.read_text(encoding="utf-8"), plan_path.parent)
    W, H, FPS, F = plan["w"], plan["h"], plan["fps"], plan["fondu"]
    font = font_opt()
    tmp = Path(tempfile.mkdtemp(prefix="montage-"))
    cover = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS}"
    parts: list[Path] = []
    total = 0.0
    for i, s in enumerate(plan["segments"]):
        out = tmp / f"{i:03d}.mp4"
        if s["type"] == "clip":
            dur = s["fin"] - s["debut"]
            inputs = ["-ss", f"{s['debut']:.3f}", "-t", f"{dur:.3f}", "-i", str(s["src"])]
            vf = cover
            audio_ok = has_audio(s["src"]) and s.get("son", 1.0) > 0
        elif s["type"] == "image":
            dur = s["duree"]
            inputs = ["-loop", "1", "-framerate", str(FPS), "-t", f"{dur:.3f}", "-i", str(s["src"])]
            if s.get("zoom"):
                frames = int(dur * FPS)
                vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
                      f"zoompan=z='min(zoom+{0.12 / max(frames, 1):.5f},1.12)':x='iw/2-(iw/zoom/2)':"
                      f"y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS},setsar=1")
            else:
                vf = cover
            audio_ok = False
        else:
            dur = s["duree"]
            inputs = ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", f"color=c=black:s={W}x{H}:r={FPS}"]
            vf = "setsar=1"
            audio_ok = False
        if s.get("texte"):
            tf = tmp / f"{i:03d}.txt"
            tf.write_text(s["texte"], encoding="utf-8")
            longest = max((len(l) for l in s["texte"].splitlines()), default=1)
            size = min(H // 14 if s["type"] == "carton" else H // 22, int(W * 0.9 / (0.62 * max(longest, 1))))
            y = "(h-text_h)/2" if s["type"] == "carton" else "h-text_h-h/8"
            vf += (f",drawtext=textfile='{ff_path(tf)}'{font}:fontsize={size}:fontcolor=white:"
                   f"x=(w-text_w)/2:y={y}:borderw=3:bordercolor=black@0.7")
        if F > 0 and dur > 2 * F:
            vf += f",fade=t=in:st=0:d={F},fade=t=out:st={dur - F:.3f}:d={F}"
        if audio_ok:
            af = f"volume={s.get('son', 1.0)},aresample=48000,aformat=channel_layouts=stereo"
            if F > 0 and dur > 2 * F:
                af += f",afade=t=in:st=0:d={F},afade=t=out:st={dur - F:.3f}:d={F}"
            args = [*inputs, "-vf", vf, "-af", af, "-map", "0:v:0", "-map", "0:a:0"]
        else:
            args = [*inputs, "-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo",
                    "-vf", vf, "-map", "0:v:0", "-map", "1:a:0"]
        run_ffmpeg([*args, "-t", f"{dur:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", str(out)])
        parts.append(out)
        total += dur
        print(f"  plan {i + 1}/{len(plan['segments'])} OK ({dur:.1f} s)")
    lst = tmp / "liste.txt"
    lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    final = Path(a.sortie)
    if plan["musique"]:
        joined = tmp / "assemble.mp4"
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)])
        music, vol = plan["musique"]
        fade_st = max(0.0, total - 1.5)
        fc = (f"[1:a]volume={vol},aresample=48000,aformat=channel_layouts=stereo,"
              f"afade=t=out:st={fade_st:.2f}:d=1.5[m];"
              f"[0:a]asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[md];"
              f"[v][md]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]")
        run_ffmpeg(["-i", str(joined), "-stream_loop", "-1", "-i", str(music), "-filter_complex", fc,
                    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-t", f"{total:.3f}", "-movflags", "+faststart", str(final)])
    else:
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(final)])
    shutil.rmtree(tmp, ignore_errors=True)
    done(str(final), f"{W}x{H}, {fmt_t(total)}, {len(parts)} plans{' + musique' if plan['musique'] else ''}")
    print(f"Vérifier : media.py planche {final}")


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
    s = sub.add_parser("galerie"); s.add_argument("chemins", nargs="+"); s.add_argument("--cols", type=int)
    s.add_argument("--largeur", type=int, default=1536); s.add_argument("--max-images", type=int, default=24)
    s.add_argument("-o"); s.set_defaults(f=cmd_galerie)
    s = sub.add_parser("monter"); s.add_argument("plan", nargs="?"); s.add_argument("sortie", nargs="?", default="montage.mp4")
    s.add_argument("--aide", action="store_true"); s.set_defaults(f=cmd_monter)
    s = sub.add_parser("ffmpeg"); s.add_argument("args", nargs=argparse.REMAINDER); s.set_defaults(f=cmd_ffmpeg)

    if len(sys.argv) > 1 and sys.argv[1] == "ffmpeg":
        cmd_ffmpeg(argparse.Namespace(args=sys.argv[2:]))
        return
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
