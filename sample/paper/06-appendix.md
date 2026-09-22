---
vivlio-paper-role: appendix
title: 付録 再現手順と系列別結果
---

# 付録 再現手順と系列別結果

## データの定義と再計算

計算はPython 3.13.5、NumPy 2.5.3、Matplotlib 3.10.8で行った。別環境では `reproduce/requirements.txt` に記載した依存関係を用意し、`python reproduce/generate.py` を実行する。日本語の図にはMeiryoまたはNoto Sans CJKを使用する。掲載図は生成済みなので、組版だけを試す場合にPythonは必要ない。

<figure class="tbl" id="tbl-dictionary">
<figcaption>系列別評価CSVの列定義</figcaption>
<table><thead><tr><th>列名</th><th>型・単位</th><th>内容</th></tr></thead><tbody>
<tr><td>trial</td><td>整数、1〜48</td><td>条件間で対応する系列番号</td></tr>
<tr><td>sigma</td><td>実数、無次元</td><td>観測ノイズの標準偏差</td></tr>
<tr><td>gap</td><td>整数、時点</td><td>一つの欠測区間の長さ</td></tr>
<tr><td>method</td><td>文字列</td><td>locf、nearest、linear</td></tr>
<tr><td>n_missing</td><td>整数、時点</td><td>評価した欠測点の総数、3×gap</td></tr>
<tr><td>rmse</td><td>実数、無次元</td><td>真値に対する二乗平均平方根誤差</td></tr>
<tr><td>mae</td><td>実数、無次元</td><td>真値に対する平均絶対誤差</td></tr>
<tr><td>bias</td><td>実数、無次元</td><td>推定値−真値の平均、符号付き</td></tr>
</tbody></table>
<p class="table-note">キーは trial、sigma、gap、method の組合せ。系列数48×ノイズ3×欠測長3×手法3 = 1,296行で、欠損値は含まない。</p>
</figure>

以下は本文のRMSEをCSVから再集計する最小例である。欠測長16、σ = 0.15を選択した後に手法別の平均を求める。元の時系列を復元する必要はない。

```python
import csv
from collections import defaultdict

values = defaultdict(list)
with open("data/trial-metrics.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if int(row["gap"]) == 16 and float(row["sigma"]) == 0.15:
            values[row["method"]].append(float(row["rmse"]))

for method, errors in values.items():
    assert len(errors) == 48
    print(method, sum(errors) / len(errors))
```

図表と本文の数値を照合するときは、丸める前のCSVを用いる。表の値を先に小数第三位に丸めてから平均すると、本文の値と末尾の桁が一致しない場合がある。ブートストラップ区間の再計算には系列ごとの対応を維持し、二手法の値を独立に再標本化しない。

## 系列別の主解析結果

<a href="#tbl-trials" data-ref="tbl"></a>は、欠測長16・σ = 0.15の全系列を示す。表を意図的に短縮せず、系列IDの順に掲載した。これにより平均誤差だけでなく、手法順位が逆転する系列と差の大きさを確認できる。<a href="03-results.md#fig-paired" data-ref="fig"></a>の一点は、この表の一行に対応する。

<!-- generated:trials -->
<figure class="tbl" id="tbl-trials">
<figcaption>主解析の系列別RMSE（σ = 0.15、欠測長16）</figcaption>
<table><thead><tr><th>系列ID</th><th>直前値保持</th><th>最近傍</th><th>線形補間</th><th>差（線形−最近傍）</th></tr></thead>
<tbody>
<tr><td>S01</td><td>0.5400</td><td>0.6388</td><td>0.5510</td><td>-0.0878</td></tr>
<tr><td>S02</td><td>1.0166</td><td>0.5977</td><td>0.3477</td><td>-0.2499</td></tr>
<tr><td>S03</td><td>0.7148</td><td>0.3255</td><td>0.3110</td><td>-0.0145</td></tr>
<tr><td>S04</td><td>0.9868</td><td>0.4323</td><td>0.3362</td><td>-0.0961</td></tr>
<tr><td>S05</td><td>1.3933</td><td>0.8021</td><td>0.6626</td><td>-0.1396</td></tr>
<tr><td>S06</td><td>0.8897</td><td>0.4585</td><td>0.4908</td><td>+0.0324</td></tr>
<tr><td>S07</td><td>0.9170</td><td>0.4715</td><td>0.3656</td><td>-0.1059</td></tr>
<tr><td>S08</td><td>0.9958</td><td>0.6085</td><td>0.6129</td><td>+0.0045</td></tr>
<tr><td>S09</td><td>0.4730</td><td>0.4229</td><td>0.4181</td><td>-0.0048</td></tr>
<tr><td>S10</td><td>0.8086</td><td>0.5918</td><td>0.5672</td><td>-0.0246</td></tr>
<tr><td>S11</td><td>0.6566</td><td>0.4550</td><td>0.4614</td><td>+0.0065</td></tr>
<tr><td>S12</td><td>0.6484</td><td>0.4456</td><td>0.4150</td><td>-0.0306</td></tr>
<tr><td>S13</td><td>0.4034</td><td>0.6414</td><td>0.5823</td><td>-0.0590</td></tr>
<tr><td>S14</td><td>0.5110</td><td>0.4422</td><td>0.4408</td><td>-0.0013</td></tr>
<tr><td>S15</td><td>1.0604</td><td>0.6699</td><td>0.4795</td><td>-0.1904</td></tr>
<tr><td>S16</td><td>1.3806</td><td>0.8090</td><td>0.6620</td><td>-0.1470</td></tr>
<tr><td>S17</td><td>0.7923</td><td>0.5965</td><td>0.6124</td><td>+0.0159</td></tr>
<tr><td>S18</td><td>0.8221</td><td>0.6758</td><td>0.6358</td><td>-0.0400</td></tr>
<tr><td>S19</td><td>0.7456</td><td>0.6950</td><td>0.6256</td><td>-0.0694</td></tr>
<tr><td>S20</td><td>0.7480</td><td>0.3646</td><td>0.2736</td><td>-0.0910</td></tr>
<tr><td>S21</td><td>0.9627</td><td>0.5936</td><td>0.3500</td><td>-0.2437</td></tr>
<tr><td>S22</td><td>0.7635</td><td>0.2495</td><td>0.2826</td><td>+0.0331</td></tr>
<tr><td>S23</td><td>0.9237</td><td>0.6555</td><td>0.4928</td><td>-0.1626</td></tr>
<tr><td>S24</td><td>0.5070</td><td>0.5010</td><td>0.4503</td><td>-0.0507</td></tr>
<tr><td>S25</td><td>0.9591</td><td>0.4187</td><td>0.3547</td><td>-0.0640</td></tr>
<tr><td>S26</td><td>0.8158</td><td>0.6284</td><td>0.5852</td><td>-0.0432</td></tr>
<tr><td>S27</td><td>1.0862</td><td>0.6309</td><td>0.5253</td><td>-0.1056</td></tr>
<tr><td>S28</td><td>0.8777</td><td>0.5093</td><td>0.4282</td><td>-0.0811</td></tr>
<tr><td>S29</td><td>0.7749</td><td>0.4682</td><td>0.2248</td><td>-0.2434</td></tr>
<tr><td>S30</td><td>0.9150</td><td>0.4079</td><td>0.3090</td><td>-0.0989</td></tr>
<tr><td>S31</td><td>0.9124</td><td>0.6522</td><td>0.4088</td><td>-0.2434</td></tr>
<tr><td>S32</td><td>0.9021</td><td>0.2917</td><td>0.2663</td><td>-0.0254</td></tr>
<tr><td>S33</td><td>0.8172</td><td>0.5666</td><td>0.5270</td><td>-0.0396</td></tr>
<tr><td>S34</td><td>0.6210</td><td>0.5533</td><td>0.4507</td><td>-0.1026</td></tr>
<tr><td>S35</td><td>0.7743</td><td>0.4667</td><td>0.2797</td><td>-0.1870</td></tr>
<tr><td>S36</td><td>1.1039</td><td>0.5874</td><td>0.3500</td><td>-0.2374</td></tr>
<tr><td>S37</td><td>1.0337</td><td>0.5818</td><td>0.4188</td><td>-0.1631</td></tr>
<tr><td>S38</td><td>0.6903</td><td>0.6619</td><td>0.5482</td><td>-0.1137</td></tr>
<tr><td>S39</td><td>1.0495</td><td>0.6452</td><td>0.4511</td><td>-0.1941</td></tr>
<tr><td>S40</td><td>0.7056</td><td>0.7253</td><td>0.4845</td><td>-0.2408</td></tr>
<tr><td>S41</td><td>0.8887</td><td>0.5120</td><td>0.4913</td><td>-0.0207</td></tr>
<tr><td>S42</td><td>1.1320</td><td>0.5617</td><td>0.3990</td><td>-0.1627</td></tr>
<tr><td>S43</td><td>0.6690</td><td>0.5614</td><td>0.5048</td><td>-0.0566</td></tr>
<tr><td>S44</td><td>0.8247</td><td>0.5286</td><td>0.4801</td><td>-0.0485</td></tr>
<tr><td>S45</td><td>0.8686</td><td>0.6600</td><td>0.5963</td><td>-0.0637</td></tr>
<tr><td>S46</td><td>0.6330</td><td>0.6231</td><td>0.5059</td><td>-0.1172</td></tr>
<tr><td>S47</td><td>0.6111</td><td>0.5285</td><td>0.4055</td><td>-0.1230</td></tr>
<tr><td>S48</td><td>1.1902</td><td>0.7099</td><td>0.2906</td><td>-0.4193</td></tr>
</tbody></table>
<p class="table-note">48系列を省略せず掲載。差が負なら線形補間のRMSEが小さい。列の単位はいずれも無次元。</p>
</figure>
<!-- /generated:trials -->

表の最後はS48である。差が正の系列も除外せず掲載している。全48個の差を平均すると−0.1023276となり、本文の−0.102はこの値を小数第三位に丸めたものである。

