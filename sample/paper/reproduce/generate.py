"""Reproduce the synthetic interpolation experiment and its publication figures.

Run from any directory: python generate.py
Dependencies are pinned in requirements.txt. No external data are downloaded.
"""
from pathlib import Path
import csv
import json
import re
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "figures"
DATA = ROOT / "data"
FIG.mkdir(exist_ok=True)
DATA.mkdir(exist_ok=True)
SEED = 20260922
N = 48
LENGTHS = [4, 8, 16]
NOISE = [0.05, 0.15, 0.30]
METHODS = ["locf", "nearest", "linear"]
LABELS = {"locf": "直前値保持", "nearest": "最近傍", "linear": "線形補間"}
COLORS = {"locf": "#777777", "nearest": "#a56216", "linear": "#195c85"}
MARKERS = {"locf": "s", "nearest": "^", "linear": "o"}
for font in [Path("C:/Windows/Fonts/meiryo.ttc"), Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")]:
    if font.exists():
        font_manager.fontManager.addfont(str(font))
        plt.rcParams["font.family"] = font_manager.FontProperties(fname=str(font)).get_name()
        break
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.labelcolor": "#202020", "text.color": "#202020", "axes.unicode_minus": False,
                     "axes.linewidth": .7, "savefig.facecolor": "white", "svg.fonttype": "path"})

def save(fig, name):
    fig.savefig(FIG / f"{name}.png", dpi=300, bbox_inches="tight", pad_inches=.12)
    fig.savefig(FIG / f"{name}.svg", bbox_inches="tight", pad_inches=.12)
    plt.close(fig)

def csv_write(name, rows):
    with (DATA / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

def one_trial(trial, gap, sigma):
    # Reset per trial so every gap/noise condition shares phase and Gaussian draws.
    rng = np.random.Generator(np.random.PCG64(SEED + trial))
    t = np.arange(240)
    phase = rng.uniform(0, 2 * np.pi)
    amplitude = rng.uniform(.8, 1.2)
    truth = amplitude * np.sin(2*np.pi*t/48 + phase) + .35*np.sin(2*np.pi*t/17) + .002*t
    observed = truth + sigma*rng.normal(size=len(t))
    starts = np.array([32, 104, 176]) + rng.integers(-8, 9, size=3)
    missing = np.zeros(len(t), dtype=bool)
    for start in starts:
        missing[start:start+gap] = True
    xp = t[~missing]
    fp = observed[~missing]
    x = t[missing]
    right = np.searchsorted(xp, x)
    left = right - 1
    nearest = np.where(x-xp[left] <= xp[right]-x, left, right)
    predictions = {"locf": fp[left], "nearest": fp[nearest], "linear": np.interp(x, xp, fp)}
    assert missing.sum() == 3*gap and not missing[0] and not missing[-1]
    return t, truth, observed, missing, predictions

rows = []
for sigma in NOISE:
    for gap in LENGTHS:
        for trial in range(N):
            t, truth, observed, missing, predictions = one_trial(trial, gap, sigma)
            for method, estimate in predictions.items():
                error = estimate-truth[missing]
                rows.append({"trial": trial+1, "sigma": sigma, "gap": gap, "method": method,
                             "n_missing": int(missing.sum()), "rmse": float(np.sqrt(np.mean(error**2))),
                             "mae": float(np.mean(np.abs(error))), "bias": float(np.mean(error))})
assert len(rows) == 1296 and all(np.isfinite(row["rmse"]) for row in rows)
csv_write("trial-metrics.csv", rows)

def values(method, gap, sigma=.15):
    return np.array([r["rmse"] for r in rows if r["method"] == method and r["gap"] == gap and r["sigma"] == sigma])

summary = []
for sigma in NOISE:
    for gap in LENGTHS:
        for method in METHODS:
            v = values(method, gap, sigma)
            summary.append({"sigma": sigma, "gap": gap, "method": method, "n": len(v),
                            "mean_rmse": float(v.mean()), "sd_rmse": float(v.std(ddof=1)),
                            "median_rmse": float(np.median(v)), "p90_rmse": float(np.quantile(v, .9))})
csv_write("summary.csv", summary)
diff = values("linear", 16) - values("nearest", 16)
rng = np.random.Generator(np.random.PCG64(SEED + 999))
boot = rng.choice(diff, size=(2000, N), replace=True).mean(axis=1)
stats = {"seed": SEED, "trials_per_condition": N, "evaluations": len(rows),
         "mean_difference_linear_minus_nearest": float(diff.mean()),
         "bootstrap_95_percentile_interval": np.quantile(boot, [.025, .975]).tolist(),
         "linear_wins_of_48": int((diff < 0).sum()),
         "python": sys.version.split()[0], "numpy": np.__version__, "matplotlib": matplotlib.__version__}
(DATA / "provenance.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")

# Figure 1: study design. Workflow boxes carry actual denominators.
fig, ax = plt.subplots(figsize=(7, 2.9))
ax.set(xlim=(0, 10), ylim=(0, 4))
ax.axis("off")
boxes = [(0.2, 2.1, "信号生成\n48系列 × 240時点"), (3.6, 2.1, "観測ノイズ\nσ = 0.05 / 0.15 / 0.30"),
         (7, 2.1, "連続欠測を付与\n長さ 4 / 8 / 16 × 3区間"),
         (7, .15, "3手法で補間\n同じ観測値・欠測位置"), (3.6, .15, "欠測点だけを評価\n真値に対するRMSE"),
         (.2, .15, "条件別に集計\n1,296件の手法評価")]
for x, y, label in boxes:
    ax.add_patch(FancyBboxPatch((x, y), 2.8, 1.15, boxstyle="square,pad=0", linewidth=.8, edgecolor="#444", facecolor="#f3f6f8"))
    ax.text(x+1.4, y+.575, label, ha="center", va="center", fontsize=9)
for a, b in [((3,2.675),(3.6,2.675)),((6.4,2.675),(7,2.675)),((8.4,2.1),(8.4,1.3)),((7,.725),(6.4,.725)),((3.6,.725),(3,.725))]:
    ax.annotate("", xy=b, xytext=a, arrowprops={"arrowstyle": "->", "color": "#444", "lw": 1})
save(fig, "01-design")

# Figure 2: complete signal and enlarged missing interval for one fixed trial.
t, truth, observed, missing, predictions = one_trial(0, 16, .15)
csv_write("example-series.csv", [{"t": int(i), "truth": float(truth[i]), "observed": float(observed[i]), "missing": int(missing[i])} for i in t])
fig, axes = plt.subplots(2, 1, figsize=(7, 5.0), layout="constrained")
for ax, lo, hi in [(axes[0], 0, 239), (axes[1], 88, 137)]:
    ax.plot(t, truth, color="#222", lw=1.1, label="生成時の真値")
    ax.scatter(t[~missing], observed[~missing], color="#999", s=5, alpha=.55, label="観測点")
    ax.fill_between(t, -2, 2.5, where=missing, color="#eeeeee", label="欠測区間")
    for method in METHODS:
        line = np.full(len(t), np.nan)
        line[missing] = predictions[method]
        ax.plot(t, line, color=COLORS[method], marker=MARKERS[method], ms=2.8, lw=1, label=LABELS[method])
    ax.set(xlim=(lo, hi), ylim=(-1.8, 2.2), ylabel="信号値（無次元）")
    ax.grid(axis="y", color="#e6e6e6", lw=.5)
axes[0].legend(ncol=3, fontsize=8, loc="upper center", bbox_to_anchor=(.5, 1.28), frameon=False)
axes[0].set_xticks([0, 48, 96, 144, 192, 239])
axes[1].set_xticks([88, 96, 104, 112, 120, 128, 137])
axes[0].set_title("(a) 全区間", loc="left", fontsize=10)
axes[1].set_title("(b) 中央の欠測区間の拡大", loc="left", fontsize=10)
axes[1].set_xlabel("時点 t")
save(fig, "02-series")

# Figure 3: means and between-trial SD, not confidence intervals.
fig, ax = plt.subplots(figsize=(7, 3.7), layout="constrained")
for offset, method in zip([-.13,0,.13], METHODS):
    v = [values(method,g) for g in LENGTHS]
    ax.errorbar(np.arange(3)+offset, [x.mean() for x in v], yerr=[x.std(ddof=1) for x in v],
                color=COLORS[method], marker=MARKERS[method], lw=1, capsize=3, label=LABELS[method])
ax.set(xticks=range(3), xticklabels=LENGTHS, xlabel="1区間の欠測長（時点）", ylabel="RMSE（無次元）", ylim=(0,1.65))
ax.grid(axis="y", color="#e6e6e6", lw=.5)
ax.legend(frameon=False, loc="upper left")
save(fig, "03-error-length")

# Figure 4: paired trials; equal scales and reference line.
fig, ax = plt.subplots(figsize=(5,4.4), layout="constrained")
x, y = values("nearest",16), values("linear",16)
ax.scatter(x, y, s=24, facecolors="white", edgecolors=COLORS["linear"], linewidths=.9)
limit = float(max(x.max(), y.max())*1.12)
ax.plot([0,limit],[0,limit], color="#555", ls="--", lw=.9, label="両手法のRMSEが等しい")
ax.set(xlim=(0,limit), ylim=(0,limit), xlabel="最近傍のRMSE", ylabel="線形補間のRMSE", aspect="equal")
ax.legend(frameon=False, fontsize=8, loc="upper left")
save(fig, "04-paired")

# Figure 5: common axes in small multiples, across noise conditions.
fig, axes = plt.subplots(1,3,figsize=(7,3.0), sharey=True, layout="constrained")
for ax, sigma in zip(axes,NOISE):
    for method in METHODS:
        ax.plot(LENGTHS, [values(method,g,sigma).mean() for g in LENGTHS], marker=MARKERS[method],
                ms=4, color=COLORS[method], lw=1, label=LABELS[method])
    ax.set(title=f"σ = {sigma:.2f}", xticks=LENGTHS, ylim=(0,1.45), xlabel="欠測長（時点）")
    ax.grid(axis="y", color="#e6e6e6", lw=.5)
axes[0].set_ylabel("平均RMSE")
axes[1].legend(frameon=False, fontsize=8, ncol=3, loc="upper center", bbox_to_anchor=(.5,1.42))
save(fig,"05-sensitivity")

def table(id_, caption, headers, records, note):
    head = "".join(f"<th>{h}</th>" for h in headers)
    body = "\n".join("<tr>"+"".join(f"<td>{v}</td>" for v in row)+"</tr>" for row in records)
    return f'<figure class="tbl" id="{id_}">\n<figcaption>{caption}</figcaption>\n<table><thead><tr>{head}</tr></thead>\n<tbody>\n{body}\n</tbody></table>\n<p class="table-note">{note}</p>\n</figure>'

tables = {}
tables["main"] = table("tbl-main", "主解析における補間誤差（σ = 0.15）", ["欠測長", "手法", "平均RMSE", "標準偏差", "中央値", "90%点"],
    [[r["gap"], LABELS[r["method"]], *[f'{r[k]:.3f}' for k in ["mean_rmse","sd_rmse","median_rmse","p90_rmse"]]] for r in summary if r["sigma"] == .15],
    "各条件48系列。標準偏差は系列間のばらつき。90%点は系列別RMSEの分位点であり、信頼区間の上限ではない。")
tables["noise"] = table("tbl-noise", "観測ノイズに対する感度分析（欠測長16）", ["σ", "直前値保持", "最近傍", "線形補間"],
    [[f"{s:.2f}", *[f"{values(m,16,s).mean():.3f}" for m in METHODS]] for s in NOISE], "値は48系列の平均RMSE。信号と欠測位置は条件間で共通とし、同一の標準正規乱数にσを掛けた。")
tables["trials"] = table("tbl-trials", "主解析の系列別RMSE（σ = 0.15、欠測長16）", ["系列ID", "直前値保持", "最近傍", "線形補間", "差（線形−最近傍）"],
    [[f"S{i+1:02d}", *[f"{values(m,16)[i]:.4f}" for m in METHODS], f"{diff[i]:+.4f}"] for i in range(N)],
    "48系列を省略せず掲載。差が負なら線形補間のRMSEが小さい。列の単位はいずれも無次元。")
for name, markup in tables.items():
    (DATA / f"table-{name}.html").write_text(markup+"\n", encoding="utf-8")
    for manuscript in ROOT.glob("*.md"):
        text = manuscript.read_text(encoding="utf-8")
        pattern = rf"<!-- generated:{name} -->[\s\S]*?<!-- /generated:{name} -->"
        updated = re.sub(pattern, lambda _: f"<!-- generated:{name} -->\n{markup}\n<!-- /generated:{name} -->", text)
        if text != updated:
            manuscript.write_text(updated, encoding="utf-8")
print(json.dumps(stats, ensure_ascii=False, indent=2))
for r in summary:
    if r["sigma"] == .15:
        print(r)
