"""30-second applications showcase; preserves the original promo files."""
import subprocess
from PIL import Image, ImageDraw
from render import OUT, W, H, FPS, BG, INK, MUTED, ACCENT, font, text, fit, card, smooth, app, detail, hinside

SOURCE = OUT/'source'
english = Image.open(SOURCE/'English.png').convert('RGB')
tanka_spread = Image.open(SOURCE/'短歌見開き.png').convert('RGB')
tanka = tanka_spread.crop((1280, 8, 2539, 1872))
paper = Image.open(SOURCE/'論文.png').convert('RGB')
manual = Image.open(SOURCE/'manual.png').convert('RGB')
print_spread = Image.open(SOURCE/'トンボ入り見開き.png').convert('RGB')
print_page = print_spread.crop((1395, 8, 2762, 1870))
# Preserve the trim area, including every corner crop mark, in the full page.
corner = print_page.crop((0, 0, 380, 330))
pages = dict(japanese=detail, english=english, tanka=tanka, paper=paper,
             manual=manual, magazine=print_page, horizontal=hinside)
thumbs = {k: fit(v,(255,390)) for k,v in pages.items()}
literature = {k: fit(pages[k],(410,585)) for k in ['japanese','english','tanka']}
knowledge = {k: fit(pages[k],(515,720)) for k in ['paper','manual']}
magazines = {k: fit(pages[k],(495,690)) for k in ['magazine','horizontal']}
screen = fit(app,(1730,710))
print_full = fit(print_page,(585,800))
print_corner = fit(corner,(360,310))
starts=[0,3,7,12,17,22,26]
ends=[3,7,12,17,22,26,30]

def base(n):
    im=Image.new('RGB',(W,H),BG)
    d=ImageDraw.Draw(im)
    d.line((82,83,127,83),fill=ACCENT,width=4)
    text(im,'Vivlio',(145,60),36,serif=True)
    text(im,'OBSIDIAN × VIVLIOSTYLE',(1440,68),21,MUTED)
    d.line((82,1000,1838,1000),fill='#d4d8ce',width=1)
    text(im,'書くものが変わっても、Vivlio。',(82,1020),20,MUTED)
    text(im,f'{n+1:02d} / 07',(1725,1020),20,MUTED)
    return im

def centered(im,s,y,size,serif=False,color=INK):
    width=ImageDraw.Draw(im).textlength(s,font=font(size,serif))
    text(im,s,((W-width)/2,y),size,color,serif)

def scene(n,u):
    im=base(n)
    drift=16*(1-smooth(max(0,min(1,u))))
    if n==0:
        centered(im,'物語も、知識も、一冊に。',175,72,True)
        centered(im,'Obsidian のノートから、さまざまな紙面へ。',285,30,color=MUTED)
        for i,(key,label) in enumerate([('english','欧文小説'),('tanka','短歌'),('paper','論文'),('manual','マニュアル'),('magazine','雑誌・印刷')]):
            asset=thumbs[key]
            x=125+i*342
            y=430+drift
            card(im,asset,x+(255-asset.width)/2,y)
            text(im,label,(x,855),29)
    elif n==1:
        text(im,'いつものノートが、紙面になる。',(100,145),58,serif=True)
        card(im,screen,(W-screen.width)/2,245+drift)
    elif n==2:
        text(im,'物語にも、詩歌にも。',(100,145),62,serif=True)
        for i,(key,label) in enumerate([('japanese','日本語小説'),('english','欧文小説'),('tanka','短歌')]):
            asset=literature[key]
            x=185+i*555
            card(im,asset,x+(410-asset.width)/2,280+drift)
            text(im,label,(x,910),32)
    elif n==3:
        text(im,'知識を、\n伝わる形に。',(95,270),63,serif=True)
        text(im,'図表のある論文。\nコードや手順を記す\nマニュアル。',(100,495),31,MUTED)
        for i,(key,label) in enumerate([('paper','論文'),('manual','マニュアル')]):
            asset=knowledge[key]
            x=690+i*590
            card(im,asset,x,170+drift)
            text(im,label,(x,930),30)
    elif n==4:
        text(im,'縦にも、横にも。',(95,250),61,serif=True)
        text(im,'図版と本文でつくる、\nマガジンの紙面。',(100,385),31,MUTED)
        for i,(key,label) in enumerate([('magazine','縦書きマガジン'),('horizontal','横書きマガジン')]):
            asset=magazines[key]
            x=690+i*590
            card(im,asset,x,195+drift)
            text(im,label,(x,927),30)
    elif n==5:
        text(im,'印刷の準備まで。',(95,230),63,serif=True)
        text(im,'トンボ入りの原稿も。',(100,360),34)
        text(im,'PDF・EPUB へ書き出し。',(100,442),30,MUTED)
        card(im,print_corner,170,570)
        text(im,'トンボを拡大',(170,910),24,MUTED)
        card(im,print_full,1090-drift,165)
    else:
        centered(im,'Vivlio',210,152,True)
        centered(im,'書くものが変わっても、',425,55,True)
        centered(im,'ノートは、本になる。',510,55,True)
        centered(im,'Obsidian のコミュニティプラグインで「Vivlio」を検索',720,31,color=MUTED)
        centered(im,'github.com/nonkuri/obsidian-vivlio',815,27,color=MUTED)
    return im

def frame(t):
    n=max(i for i,s in enumerate(starts) if t>=s)
    im=scene(n,(t-starts[n])/(ends[n]-starts[n]))
    if n and t-starts[n]<.4:
        im=Image.blend(scene(n-1,1),im,smooth((t-starts[n])/.4))
    if t<.3:
        im=Image.blend(Image.new('RGB',(W,H),BG),im,smooth(t/.3))
    return im

def render():
    silent=OUT/'vivlio-showcase-ja-30s.mp4'
    proc=subprocess.Popen(['ffmpeg','-y','-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE)
    try:
        for i in range(30*FPS):
            proc.stdin.write(frame(i/FPS).tobytes())
            if i%150==0: print(f'Rendered {i/FPS:.0f}/30 seconds',flush=True)
    finally:
        proc.stdin.close()
    if proc.wait(): raise RuntimeError('Video encoding failed')
    output=OUT/'vivlio-showcase-ja-30s-bgm.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(silent),'-i',str(OUT/'vivlio-original-bgm.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','loudnorm=I=-20:TP=-2:LRA=7','-c:a','aac','-b:a','192k','-ar','48000','-t','30','-movflags','+faststart',str(output)],check=True)
    sheet=Image.new('RGB',(1920,2160),BG)
    for i,t in enumerate([1.5,5,9.5,14.5,19.5,24,28]):
        sheet.paste(frame(t).resize((960,540),Image.Resampling.LANCZOS),((i%2)*960,(i//2)*540))
    sheet.save(OUT/'showcase-storyboard.jpg',quality=94)
    frame(1.5).save(OUT/'showcase-poster.png')
    print(output,flush=True)

if __name__=='__main__': render()
