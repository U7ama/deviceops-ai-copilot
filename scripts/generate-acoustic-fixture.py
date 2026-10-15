"""Original synthetic waveform, with an injected tone; not equipment measurements."""
import csv,math,random
from pathlib import Path
random.seed(7)
p=Path('fixtures/enterprise/fan-vibration.csv')
with p.open('w',newline='') as f:
    writer=csv.writer(f);writer.writerow(['time_seconds','baseline_amplitude','observed_amplitude'])
    for n in range(4096):
        t=n/16000;base=.2*math.sin(2*math.pi*200*t)+random.uniform(-.005,.005)
        observed=base+.35*math.sin(2*math.pi*3200*t)
        writer.writerow([f'{t:.8f}',f'{base:.8f}',f'{observed:.8f}'])
