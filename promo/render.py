"""Render the 30-second Vivlio promo. Requires Pillow and ffmpeg on PATH."""
from pathlib import Path
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent
W, H, FPS = 1920, 1080, 30
BG = '#f3f0e7'
INK = '#244341'
MUTED = '#657975'
ACCENT = '#b97651'
fonts = {}
def font(size, serif=False):
    key = (size, serif)
    if key not in fonts:
        fonts[key] = ImageFont.truetype('C:/Windows/Fonts/' + ('yumin.ttf' if serif else 'YuGothM.ttc'), size)
    return fonts[key]

def text(im, s, xy, size=32, color=INK, serif=False):
    for i,line in enumerate(s.split('\n')):
        ImageDraw.Draw(im).text((xy[0],xy[1]+i*(size+32)), line, font=font(size, serif), fill=color, anchor='lt')

def fit(im, size):
    scale = min(size[0]/im.width, size[1]/im.height)
    return im.resize((round(im.width*scale), round(im.height*scale)), Image.Resampling.LANCZOS)

app = Image.open(OUT/'source/Obsidian画面.png').convert('RGB')
spread = Image.open(ROOT/'docs/images/spread.png').convert('RGB')
vertical = Image.open(ROOT/'sample/css/vertical-magazine/preview.png').convert('RGB')
horizontal = Image.open(ROOT/'sample/css/horizontal-magazine/preview.png').convert('RGB')
detail = Image.open(OUT/'source/杜子春.png').convert('RGB')
novel = spread.crop((844, 48, 1636, 1164))
vcover = vertical.crop((48, 54, 584, 806))
vinside = vertical.crop((672, 54, 1208, 806))
hinside = horizontal.crop((456, 41, 809, 536))
assets = {
 'spread': fit(spread.crop((48,48,1636,1164)), (1050, 738)),
 'app': fit(app, (1730, 715)),
 'detail': fit(detail, (655, 860)),
 'novel': fit(novel, (440, 620)),
 'vertical': fit(vinside, (440, 620)),
 'horizontal': fit(hinside, (440, 620)),
 'inside': fit(vinside, (400, 565)),
 'outcover': fit(vcover, (400, 565)),
}

def card(im, asset, x, y):
    x, y = int(x), int(y)
    d = ImageDraw.Draw(im)
    d.rectangle((x+12,y+16,x+asset.width+12,y+asset.height+16), fill='#deded3')
    im.paste(asset, (x,y))

def base(n):
    im = Image.new('RGB', (W,H), BG)
    d=ImageDraw.Draw(im)
    d.line((82, 83, 127, 83), fill=ACCENT, width=4)
    text(im, 'Vivlio', (145, 60), 36, serif=True)
    text(im, 'OBSIDIAN × VIVLIOSTYLE', (1440, 68), 21, MUTED)
    d.line((82,1000,1838,1000), fill='#d4d8ce', width=1)
    text(im, 'ノートから、本へ。', (82,1020), 20, MUTED)
    text(im, f'{n:02d} / 06', (1725,1020), 20, MUTED)
    return im

def smooth(u):
    return u*u*(3-2*u)

def scene(n, u):
    im=base(n+1)
    drift = 18*(1-smooth(max(0,min(1,u))))
    if n==0:
        text(im,'書いた言葉を、\n本のかたちに。',(100,300),72,serif=True)
        text(im,'いつもの Obsidian から。',(106,535),30,MUTED)
        text(im,'Vivlio',(102,650),100,serif=True)
        card(im,assets['spread'],800+drift,205)
    elif n==1:
        text(im,'原稿の隣に、仕上がりを。',(100,145),58,serif=True)
        card(im,assets['app'],(W-assets['app'].width)/2,245+drift)
    elif n==2:
        text(im,'日本語を、\n美しく組む。',(110,250),78,serif=True)
        text(im,'縦書き  /  ルビ  /  傍点',(115,535),35)
        text(im,'読みやすさを、ページの細部まで。',(115,625),29,MUTED)
        card(im,assets['detail'],1070-drift,135)
    elif n==3:
        text(im,'小説も、雑誌も。',(100,145),62,serif=True)
        for i,(key,label) in enumerate([('novel','小説'),('vertical','縦書きマガジン'),('horizontal','横書きマガジン')]):
            x=180+i*555
            card(im,assets[key],x,272+drift*(i+1)/3)
            text(im,label,(x,924),27)
    elif n==4:
        text(im,'読む人へ、届けよう。',(100,190),66,serif=True)
        text(im,'PDF  /  EPUB',(108,350),85,serif=True)
        text(im,'印刷にも、電子書籍にも。',(113,498),34)
        text(im,'プレビューから書き出し。',(113,585),29,MUTED)
        card(im,assets['outcover'],1050-drift,230)
        card(im,assets['inside'],1395-drift,340)
    else:
        d=ImageDraw.Draw(im)
        d.line((910,185,1010,185),fill=ACCENT,width=4)
        # Center each line using font metrics, keeping the final CTA readable.
        for s,y,size,serif,color in [
          ('Vivlio',260,170,True,INK),
          ('Obsidianのノートが、本になる。',510,57,True,INK),
          ('Obsidian のコミュニティプラグインで「Vivlio」を検索',685,31,False,MUTED),
          ('github.com/nonkuri/obsidian-vivlio',785,27,False,MUTED)]:
            width=ImageDraw.Draw(im).textlength(s,font=font(size,serif))
            text(im,s,((W-width)/2,y),size,color,serif)
    return im

starts=[0,5,10,15,21,26]
ends=[5,10,15,21,26,30]
def frame(t):
    n=max(i for i,s in enumerate(starts) if t>=s)
    im=scene(n,(t-starts[n])/(ends[n]-starts[n]))
    if n>0 and t-starts[n]<0.45:
        im=Image.blend(scene(n-1,1),im,smooth((t-starts[n])/0.45))
    if t<0.4:
        im=Image.blend(Image.new('RGB',(W,H),BG),im,smooth(t/0.4))
    return im

def render():
    output=OUT/'vivlio-promo-ja-30s.mp4'
    cmd=['ffmpeg','-y','-loglevel','warning','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(output)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for i in range(30*FPS):
            proc.stdin.write(frame(i/FPS).tobytes())
            if i%150==0: print(f'Rendered {i/FPS:.0f}/30 seconds',flush=True)
    finally:
        proc.stdin.close()
    if proc.wait()!=0: raise RuntimeError('ffmpeg failed')
    frame(28).save(OUT/'poster.png')
    sheet=Image.new('RGB',(960*2,540*3),BG)
    for i,t in enumerate([2.5,7.5,12.5,18,23.5,28]):
        sheet.paste(frame(t).resize((960,540),Image.Resampling.LANCZOS),((i%2)*960,(i//2)*540))
    sheet.save(OUT/'storyboard.jpg',quality=92)
    print(output,flush=True)

if __name__=='__main__': render()
