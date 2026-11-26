"""Roboflow veri setlerini YOLOv8 biçiminde indirir (datasets.yaml).

1) API anahtarı ile (önerilen):
     set ROBOFLOW_API_KEY=xxxxxxxx          (Windows cmd)   |  export ROBOFLOW_API_KEY=xxxx  (Linux/Colab)
     python indir_veri.py                    (hepsi)
     python indir_veri.py --set plaka_tespit
   Anahtar: https://app.roboflow.com -> Settings -> Roboflow API -> Private API Key (ücretsiz hesap yeterli)

2) Elle indirme: veri seti sayfasında "Download Dataset" -> biçim "YOLOv8" -> "Download zip to computer"
     python indir_veri.py --zip plate-detection.v2i.yolov8.zip --hedef data/plaka_tespit

İndirme sonrası data.yaml yolları düzeltilir (mutlak 'path'); test kümesi yoksa bolme.py önerilir.
"""
from __future__ import annotations

import argparse
import os
import sys
import zipfile
from pathlib import Path

from ortak import TRAINING_DIR, find_split_dir, fix_data_yaml, list_images, load_yaml


def summarize(root: Path) -> None:
    for split in ("train", "valid", "test"):
        d = find_split_dir(root, split)
        n = len(list_images(d)) if d else 0
        print(f"   {split:<5}: {n} resim")
    if find_split_dir(root, "test") is None:
        print("   Not: test kümesi yok. %70/20/10 bölmek için: "
              f"python bolme.py --kaynak {root} --hedef {root}_bolunmus")


def download_roboflow(cfg: dict, target: Path, api_key: str) -> Path:
    try:
        from roboflow import Roboflow
    except ImportError:
        sys.exit("roboflow paketi kurulu değil: pip install roboflow")
    rf = Roboflow(api_key=api_key)
    project = rf.workspace(cfg["workspace"]).project(cfg["project"])
    ds = project.version(int(cfg["version"])).download(cfg.get("format", "yolov8"), location=str(target), overwrite=True)
    return Path(ds.location)


def extract_zip(zip_path: Path, target: Path) -> Path:
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for member in z.namelist():  # zip içinden klasör dışına yazmayı engelle
            dest = (target / member).resolve()
            if not str(dest).startswith(str(target.resolve())):
                sys.exit(f"Güvensiz zip girdisi: {member}")
        z.extractall(target)
    # Zip tek bir üst klasör içeriyorsa onu kök kabul et
    subdirs = [p for p in target.iterdir() if p.is_dir()]
    if not (target / "data.yaml").exists() and len(subdirs) == 1 and (subdirs[0] / "data.yaml").exists():
        return subdirs[0]
    return target


def main():
    ap = argparse.ArgumentParser(description="Roboflow veri setlerini indir")
    ap.add_argument("--set", choices=["plaka_tespit", "karakter_okuma", "hepsi"], default="hepsi")
    ap.add_argument("--zip", help="Elle indirilmiş Roboflow YOLOv8 zip dosyası")
    ap.add_argument("--hedef", help="Hedef klasör (zip için zorunlu; aksi hâlde datasets.yaml'daki)")
    ap.add_argument("--api-key", default=os.environ.get("ROBOFLOW_API_KEY"), help="vars. ROBOFLOW_API_KEY ortam değişkeni")
    args = ap.parse_args()

    if args.zip:
        if not args.hedef:
            sys.exit("--zip ile birlikte --hedef verin (ör. data/plaka_tespit)")
        root = extract_zip(Path(args.zip), (TRAINING_DIR / args.hedef) if not Path(args.hedef).is_absolute() else Path(args.hedef))
        yml = fix_data_yaml(root)
        print(f"OK Açıldı: {root}\n   data.yaml: {yml}")
        summarize(root)
        return

    if not args.api_key:
        sys.exit("ROBOFLOW_API_KEY tanımlı değil. Anahtarı ortam değişkenine yazın ya da --zip ile elle indirilen dosyayı verin.")
    sets = load_yaml(TRAINING_DIR / "datasets.yaml")
    keys = list(sets) if args.set == "hepsi" else [args.set]
    for key in keys:
        cfg = sets[key]
        target = Path(args.hedef) if args.hedef and len(keys) == 1 else TRAINING_DIR / cfg["hedef"]
        print(f"-> {key}: {cfg['url']} -> {target}")
        root = download_roboflow(cfg, target, args.api_key)
        yml = fix_data_yaml(root)
        print(f"OK İndirildi. data.yaml: {yml}")
        summarize(root)


if __name__ == "__main__":
    main()
