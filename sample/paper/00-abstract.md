---
vivlio-paper-role: abstract
title: 要旨
---

# 要旨

連続した欠測区間を含む時系列では、欠測長と観測ノイズの組合せによって補間誤差が変化する。本稿では、既知の真値を持つ二つの周期成分と線形傾向を合成し、直前値保持、最近傍補間、線形補間の三手法を比較した。48系列、3種類の欠測長、3水準のノイズを組み合わせ、計1,296件の手法評価を行った。評価対象は欠測した時点に限定し、生成時の真値に対する二乗平均平方根誤差（RMSE）を求めた。

主解析のノイズ標準偏差0.15では、線形補間の平均RMSEは欠測長4、8、16でそれぞれ0.151、0.254、0.452であった。欠測長16における最近傍補間との差は−0.102で、系列単位の再標本化による95%パーセンタイル区間は［−0.129, −0.077］であった。ただし、全系列で線形補間が優れていたわけではなく、48系列中5系列では最近傍補間のRMSEが小さかった。周期成分の曲率と欠測位置の関係が、平均値だけでは見えない誤差の変動に関係する。

本稿は合成信号に対する計算実験であり、実測データによる補間性能の検証ではない。生成式、乱数種、条件別集計、系列別の評価値を公開し、結果の再計算と図表の再生成を可能にした。将来の観測値を利用できる事後補完を対象としており、オンライン予測への適用は扱わない。

**キーワード：** 時系列、欠測、補間、再現可能性、数値実験

## Abstract

We compare last observation carried forward, nearest-neighbor interpolation, and linear interpolation using synthetic periodic time series with contiguous missing blocks. Forty-eight realizations, three block lengths, and three noise levels yield 1,296 method evaluations. Errors are measured only at missing positions against the known noise-free signal. At a noise standard deviation of 0.15 and a block length of 16, the mean root mean squared errors are 0.844, 0.555, and 0.452, respectively. Linear interpolation improves the mean error but does not dominate every realization. The experiment illustrates how local curvature and gap placement affect reconstruction. All inputs, evaluation tables, plotting code, and random seeds are supplied. These computational results do not establish performance on measured sensor data or real-time forecasting tasks.

<div class="sample-notice">本稿は Vivlio の組版検証用に作成したオリジナルの模擬論文です。データは同梱コードで生成した合成信号であり、実在の研究・被験者・測定施設を報告するものではありません。</div>
