"""Bounded waveform comparison; spectral observations are not a hardware-fault classifier."""
import csv, glob, itertools, json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
files=glob.glob('*.csv')
if len(files)!=1: raise ValueError('Select exactly one waveform CSV')
with open(files[0],newline='') as source:
    reader=csv.DictReader(source)
    if not {'time_seconds','baseline_amplitude','observed_amplitude'}.issubset(reader.fieldnames or []):
        raise ValueError('Expected time_seconds, baseline_amplitude and observed_amplitude columns')
    rows=list(itertools.islice(reader,262145))
if not 64<=len(rows)<=262144: raise ValueError('Waveform requires 64 to 262144 samples')
data=np.array([[float(r[k]) for k in ('time_seconds','baseline_amplitude','observed_amplitude')] for r in rows])
if not np.isfinite(data).all(): raise ValueError('Non-finite waveform samples')
time,baseline,observed=data.T
steps=np.diff(time)
if not (steps>0).all() or not np.allclose(steps,steps[0],rtol=0.001,atol=1e-9):
    raise ValueError('Uniform increasing sample timestamps required')
rate=1/float(np.median(steps));window=np.hanning(len(time))
def spectrum(values): return np.abs(np.fft.rfft((values-np.mean(values))*window))*2/window.sum()
base,actual=spectrum(baseline),spectrum(observed)
frequency=np.fft.rfftfreq(len(time),d=1/rate)
peak=int(np.argmax(actual[1:])+1)
print(json.dumps({'samples':len(time),'sampleRateHz':round(rate,3),'frequencyResolutionHz':round(rate/len(time),3),'dominantObservedHz':round(float(frequency[peak]),3),'baselineAmplitudeAtPeak':float(base[peak]),'observedAmplitudeAtPeak':float(actual[peak]),'interpretation':'Spectral difference only; cause and equipment condition are unverified.'}))
fig,axes=plt.subplots(2,1,figsize=(9,6),constrained_layout=True)
axes[0].plot(time[:400],baseline[:400],label='Baseline');axes[0].plot(time[:400],observed[:400],label='Observed',alpha=0.8);axes[0].set(xlabel='Time (seconds)',ylabel='Relative amplitude');axes[0].legend()
axes[1].plot(frequency,base,label='Baseline');axes[1].plot(frequency,actual,label='Observed');axes[1].set(xlabel='Frequency (Hz)',ylabel='Windowed amplitude',title='Spectral comparison - not a fault diagnosis');axes[1].legend()
fig.savefig('exports/acoustic-spectrum.png');plt.close(fig)
