import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Component, DestroyRef, OnInit, inject, signal, effect } from '@angular/core';
import * as echarts from 'echarts/core';
import { Router } from '@angular/router';
import type { EChartsCoreOption } from 'echarts';
import { ScatterChart, LineChart, BarChart, HeatmapChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  PolarComponent,
  LegendComponent,
  VisualMapComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { HeartStore } from '../../state/heart.store';

echarts.use([
  ScatterChart,
  LineChart,
  BarChart,
  HeatmapChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  PolarComponent,
  LegendComponent,
  VisualMapComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

@Component({
  selector: 'dot-plots-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dot-plots.component.html',
  styleUrls: ['./dot-plots.component.scss'],
})
export class DotPlotsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private store = inject(HeartStore);
  data = signal<any | null>(null);
  loading = signal(false);
  examInfo = signal<{
    date: string;
    hrBpm: number;
    bp: string;
    efPct: number;
    diagnosis: string;
  } | null>(null);
  private fallbackUsed = false;
  private lastLoadedId: string | null = null;
  // React to future selection changes (must be created in injection context)
  private selectionEffect = effect(() => {
    const id = this.store.selectedId();
    if (!id || id === this.lastLoadedId) return;
    this.fetchAndRender(id);
  });

  // Refs for charts
  private charts: echarts.ECharts[] = [];
  private chartMap: Record<string, echarts.ECharts> = {};
  private prog: Record<
    string,
    { step: number; series: Array<{ idx: number; full: any[]; shown: number }> }
  > = {};
  private onWindowResize = () => {
    // Resize all charts on window resize
    this.charts.forEach((c) => c.resize());
  };

  constructor(private router: Router) {}

  ngOnInit() {
    // Ensure patients are loaded, pick a selection or fallback to demo data, then render.
    (async () => {
      try {
        if (!this.store.patients().length) {
          await this.store.init();
        }
      } catch {
        await this.applyFallbackAndRender();
        return;
      }

      const patients = this.store.patients();
      if (!patients.length) {
        await this.applyFallbackAndRender();
        return;
      }

      const id = this.store.selectedId() ?? patients[0]?.id ?? null;
      if (id && this.store.selectedId() !== id) {
        this.store.select(id);
      }
      if (id) {
        await this.fetchAndRender(id);
      } else {
        await this.applyFallbackAndRender();
      }
    })();

    // Cleanup
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('resize', this.onWindowResize);
      this.charts.forEach((c) => c.dispose());
      this.charts = [];
      this.chartMap = {};
    });

    // Global resize listener
    window.addEventListener('resize', this.onWindowResize);
  }

  logout() {
    try {
      localStorage.removeItem('auth');
    } catch {}
    this.router.navigateByUrl('/');
  }

  private async fetchAndRender(patientId: string) {
    this.loading.set(true);
    try {
      const res = await fetch(`/data/analytics-${encodeURIComponent(patientId)}.json`);
      if (!res.ok) throw new Error(`Local analytics missing`);
      this.data.set(await res.json());
    } catch {
      // If local unavailable, use fallback
      await this.applyFallbackData();
    } finally {
      this.loading.set(false);
    }
    // Build/synthesize exam meta for medical annotations
    this.examInfo.set(this.buildExamInfo(patientId, this.data()));
    // Recreate charts with the new data
    this.disposeCharts();
    queueMicrotask(() => this.renderAll());
    this.lastLoadedId = patientId;
  }

  private async applyFallbackData() {
    if (this.fallbackUsed && this.data()) return;
    try {
      // Prefer a local per-patient analytics file as fallback
      const res = await fetch('/data/analytics-p1.json');
      this.data.set(await res.json());
      this.fallbackUsed = true;
    } catch {
      // Ultimate fallback (legacy sample)
      try {
        const res2 = await fetch('/data/sample-metrics.json');
        this.data.set(await res2.json());
        this.fallbackUsed = true;
      } catch {
        // No data available; keep null
      }
    }
  }

  private async applyFallbackAndRender() {
    await this.applyFallbackData();
    if (this.data()) {
      this.disposeCharts();
      queueMicrotask(() => this.renderAll());
    }
  }

  private renderAll() {
    const d = this.data();
    if (!d) return;
    // 1. Scatter: LV Volume vs Ejection Fraction
    this.mountProgressive('#chart1', this.scatterLVvsEF(d.scatter));
    // 2. Dot/Strip
    this.mountProgressive('#chart2', this.stripPlot(d.strip));
    // 3. Violin + dots (approximate using density line + scatter overlay)
    this.mountProgressive('#chart3', this.violinLike(d.violin));
    // 4. Timeline dots
    this.mountProgressive('#chart4', this.timelineDots(d.timeline));
    // 5. Bubble chart
    this.mountProgressive('#chart5', this.bubbleChart(d.bubble));
    // 6. Polar scatter
    this.mountProgressive('#chart6', this.polarScatter(d.polar));
    // 7. Correlation matrix with dot size/color
    this.mountProgressive('#chart7', this.corrMatrix(d.corr));
    // 8. Swarm (approx: jittered strip)
    this.mountProgressive('#chart8', this.swarmPlot(d.swarm));

    // Ensure charts render correctly when an accordion is opened
    document.querySelectorAll('details.accordion').forEach((el) => {
      el.addEventListener('toggle', () => {
        const details = el as HTMLDetailsElement;
        if (!details.open) return;
        const container = details.querySelector('.card') as HTMLElement | null;
        if (!container || !container.id) return;
        // Delay to allow layout to settle
        setTimeout(() => {
          const chart = this.chartMap[container.id];
          if (chart) chart.resize();
        }, 0);
      });
    });
  }

  private mount(sel: string, option: echarts.EChartsCoreOption) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.setOption(option);
    this.charts.push(chart);
    if (el.id) this.chartMap[el.id] = chart;
  }

  private mountProgressive(
    sel: string,
    build: {
      option: EChartsCoreOption;
      progressive?: Array<{ idx: number; full: any[]; shown: number }>;
      step?: number;
    }
  ) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.setOption(build.option);
    this.charts.push(chart);
    if (el.id) this.chartMap[el.id] = chart;
    if (el.id && build.progressive?.length) {
      this.prog[el.id] = {
        step: build.step ?? 200,
        series: build.progressive.map((p) => ({ idx: p.idx, full: p.full, shown: p.shown })),
      };
      const reveal = () => this.revealMore(el.id!, chart);
      chart.on('dataZoom', reveal);
      chart.getZr().on('dblclick', reveal);
    }
  }

  private revealMore(id: string, chart: echarts.ECharts) {
    const state = this.prog[id];
    if (!state) return;
    let remaining = state.step;
    const updates: { seriesIndex: number; data: any[] }[] = [];
    let progressed = false;
    while (remaining > 0) {
      progressed = false;
      for (const s of state.series) {
        if (remaining <= 0) break;
        if (s.shown >= s.full.length) continue;
        const add = Math.min(
          remaining,
          Math.max(1, Math.floor(state.step / Math.max(1, state.series.length)))
        );
        s.shown = Math.min(s.shown + add, s.full.length);
        updates.push({ seriesIndex: s.idx, data: s.full.slice(0, s.shown) });
        remaining -= add;
        progressed = true;
      }
      if (!progressed) break;
    }
    if (updates.length) {
      chart.setOption(
        { series: updates.map((u) => ({ index: u.seriesIndex, data: u.data })) },
        false
      );
    }
  }

  private disposeCharts() {
    this.charts.forEach((c) => c.dispose());
    this.charts = [];
    this.chartMap = {};
    this.prog = {};
  }

  private scatterLVvsEF(points: Array<{ lv: number; ef: number; id?: string }>): {
    option: EChartsCoreOption;
    progressive: Array<{ idx: number; full: any[]; shown: number }>;
    step: number;
  } {
    const exam = this.examInfo();
    const base = points.map((p) => [p.lv, p.ef]);
    const full = this.expandToN(base, 1000, 0.8, 1.2);
    const shown = Math.min(200, full.length);
    const option: EChartsCoreOption = {
      title: { text: 'LV Volume vs Ejection Fraction' },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const [lv, ef] = p.data || [];
          return `LV ${lv} ml\nEF ${ef}%` + (exam ? `\nHR ${exam.hrBpm} bpm\nBP ${exam.bp}` : '');
        },
      },
      xAxis: { name: 'LV Volume (ml)' },
      yAxis: { name: 'Ejection Fraction (%)', min: 0, max: 80 },
      dataZoom: [{ type: 'inside' }, { type: 'slider' }],
      series: [
        {
          type: 'scatter',
          symbolSize: 10,
          data: full.slice(0, shown),
          markLine: {
            silent: true,
            data: [
              { yAxis: 55, name: 'EF Normal ≥55%' },
              { yAxis: 40, name: 'EF Reduced <40%' },
            ],
            label: { formatter: '{b}' },
            lineStyle: { type: 'dashed' },
          },
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(76,175,80,0.10)' },
            data: [[{ yAxis: 55 }, { yAxis: 80 }]],
          },
        },
      ],
    };
    return { option, progressive: [{ idx: 0, full, shown }], step: 200 };
  }

  private stripPlot(input: { groups: string[]; values: Record<string, number[]> }): {
    option: EChartsCoreOption;
    progressive: Array<{ idx: number; full: any[]; shown: number }>;
    step: number;
  } {
    const series: any[] = [];
    const prog: Array<{ idx: number; full: any[]; shown: number }> = [];
    const perSeriesTarget = Math.ceil(1000 / Math.max(1, input.groups.length));
    const perSeriesShown = Math.max(1, Math.floor(200 / Math.max(1, input.groups.length)));
    input.groups.forEach((g, idx) => {
      const base = (input.values[g] ?? []).map((v) => [idx + 1 + (Math.random() - 0.5) * 0.2, v]);
      const full = this.expandToN(base, perSeriesTarget, 0.2, 0.8);
      const shown = Math.min(perSeriesShown, full.length);
      const s = {
        name: g,
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: full.slice(0, shown),
        symbolSize: 8,
        markLine: {
          symbol: 'none',
          data: [{ name: 'Mean', type: 'average' }],
          lineStyle: { type: 'dashed' },
        },
      };
      series.push(s);
      prog.push({ idx: series.length - 1, full, shown });
    });
    return {
      option: {
        title: { text: 'Ejection Fraction by Group (Strip Plot)' },
        tooltip: { trigger: 'item' },
        xAxis: {
          name: 'Group',
          type: 'value',
          min: 0,
          max: input.groups.length + 1,
          axisLabel: { formatter: (v: number) => input.groups[v - 1] ?? '' },
        },
        yAxis: { name: 'EF (%)' },
        dataZoom: [{ type: 'inside' }, { type: 'slider' }],
        series,
      },
      progressive: prog,
      step: 200,
    };
  }

  private violinLike(input: { groups: string[]; values: Record<string, number[]> }): {
    option: EChartsCoreOption;
    progressive: Array<{ idx: number; full: any[]; shown: number }>;
    step: number;
  } {
    // Not a true violin; density estimation is approximated by bins (for demo)
    const bins = (arr: number[], n = 20) => {
      const min = Math.min(...arr),
        max = Math.max(...arr),
        step = (max - min) / n || 1;
      const counts = Array.from({ length: n }, (_, i) => ({ y: min + i * step, c: 0 }));
      for (const v of arr) {
        const i = Math.min(n - 1, Math.max(0, Math.floor((v - min) / step)));
        counts[i].c++;
      }
      return counts.map((b) => [b.c, b.y]);
    };
    const series: any[] = [];
    const prog: Array<{ idx: number; full: any[]; shown: number }> = [];
    input.groups.forEach((g, idx) => {
      const values = input.values[g] ?? [];
      series.push({
        name: `${g} density`,
        type: 'line',
        smooth: true,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: bins(values),
        encode: { x: 0, y: 1 },
        lineStyle: { width: 1 },
        areaStyle: {},
      });
      const baseScatter = values.map((v) => [idx + 1 + (Math.random() - 0.5) * 0.2, v]);
      const full = this.expandToN(
        baseScatter,
        Math.ceil(1000 / Math.max(1, input.groups.length)),
        0.2,
        0.8
      );
      const shown = Math.max(1, Math.floor(200 / Math.max(1, input.groups.length)));
      const scatterSeries = {
        name: g,
        type: 'scatter',
        data: full.slice(0, shown),
        symbolSize: 6,
      };
      series.push(scatterSeries);
      prog.push({ idx: series.length - 1, full, shown });
    });
    const all = input.groups.flatMap((g) => input.values[g] ?? []);
    const median = this.median(all);
    return {
      option: {
        title: { text: 'HRV Distribution (Violin-like + Dots)' },
        tooltip: { trigger: 'item' },
        xAxis: { name: 'Group', type: 'value', min: 0, max: input.groups.length + 1 },
        yAxis: { name: 'HRV' },
        dataZoom: [{ type: 'inside' }, { type: 'slider' }],
        series: [
          ...series,
          {
            type: 'line',
            name: 'Median',
            data: [
              [0, median],
              [input.groups.length + 1, median],
            ],
            symbol: 'none',
            lineStyle: { type: 'dashed', color: '#ffa726' },
          },
        ],
      },
      progressive: prog,
      step: 200,
    };
  }

  private timelineDots(events: Array<{ t: number; label?: string }>): {
    option: EChartsCoreOption;
    progressive: Array<{ idx: number; full: any[]; shown: number }>;
    step: number;
  } {
    const first = events?.[0]?.t ?? 0;
    const last = events?.[events.length - 1]?.t ?? 0;
    const base = (events ?? []).map((e) => [e.t, 0.5]);
    const full = this.expandToN(base, 1000, 1.0, 0.02);
    const shown = Math.min(200, full.length);
    return {
      option: {
        title: { text: 'Arrhythmia Events Timeline' },
        tooltip: { trigger: 'item' },
        xAxis: { name: 'Time (s)', type: 'value' },
        yAxis: { show: false, min: 0, max: 1 },
        dataZoom: [{ type: 'inside' }, { type: 'slider' }],
        series: [
          {
            type: 'scatter',
            symbolSize: 10,
            data: full.slice(0, shown),
            markArea: {
              silent: true,
              data: [[{ xAxis: first }, { xAxis: Math.min(last, first + 10) }]],
              itemStyle: { color: 'rgba(33,150,243,0.08)' },
              label: { show: true, formatter: 'Baseline Window' },
            },
            markPoint: {
              data: [
                { name: 'Onset', coord: [first, 0.5] },
                { name: 'Last', coord: [last, 0.5] },
              ],
            },
          },
        ],
      },
      progressive: [{ idx: 0, full, shown }],
      step: 200,
    };
  }

  private bubbleChart(points: Array<{ x: number; y: number; r: number; color?: string }>): {
    option: EChartsCoreOption;
    progressive: Array<{ idx: number; full: any[]; shown: number }>;
    step: number;
  } {
    const base = points.map((p) => [p.x, p.y, p.r]);
    const full = this.expandToN(base, 1000, 1.0, 1.0, true);
    const shown = Math.min(200, full.length);
    return {
      option: {
        title: { text: 'Bubble Chart (QRS vs PR, size=risk)' },
        tooltip: { trigger: 'item' },
        xAxis: { name: 'QRS (ms)', min: 60, max: 200 },
        yAxis: { name: 'PR (ms)', min: 60, max: 300 },
        dataZoom: [{ type: 'inside' }, { type: 'slider' }],
        series: [
          {
            type: 'scatter',
            symbolSize: (p: any) => p[2],
            data: full.slice(0, shown),
            markLine: {
              silent: true,
              data: [
                { xAxis: 120, name: 'QRS 120ms' },
                { yAxis: 200, name: 'PR 200ms' },
              ],
              lineStyle: { type: 'dashed' },
              label: { formatter: '{b}' },
            },
            markArea: {
              silent: true,
              data: [
                [{ xAxis: 120 }, { xAxis: 200 }],
                [{ yAxis: 200 }, { yAxis: 300 }],
              ],
              itemStyle: { color: 'rgba(239,83,80,0.08)' },
            },
          },
        ],
      },
      progressive: [{ idx: 0, full, shown }],
      step: 200,
    };
  }

  private polarScatter(points: Array<{ theta: number; r: number }>): {
    option: EChartsCoreOption;
    progressive: Array<{ idx: number; full: any[]; shown: number }>;
    step: number;
  } {
    const base = points.map((p) => [p.theta, p.r]);
    const full = this.expandToN(base, 1000, 1.0, 1.0);
    const shown = Math.min(200, full.length);
    return {
      option: {
        title: { text: 'Polar Dot Plot (Activation Phase)' },
        angleAxis: { type: 'value', startAngle: 90 },
        radiusAxis: {},
        polar: {},
        dataZoom: [
          { type: 'inside', angleAxisIndex: 0 },
          { type: 'inside', radiusAxisIndex: 0 },
        ],
        series: [{ type: 'scatter', coordinateSystem: 'polar', data: full.slice(0, shown) }],
      },
      progressive: [{ idx: 0, full, shown }],
      step: 200,
    };
  }

  private corrMatrix(input: { labels: string[]; matrix: number[][] }): {
    option: EChartsCoreOption;
    progressive: Array<{ idx: number; full: any[]; shown: number }>;
    step: number;
  } {
    const data: [number, number, number][] = [];
    input.matrix.forEach((row, i) => row.forEach((v, j) => data.push([i, j, v])));
    let top: { i: number; j: number; v: number } | undefined;
    input.matrix.forEach((row, i) =>
      row.forEach((v, j) => {
        if (i === j) return;
        if (!top || Math.abs(v) > Math.abs(top.v)) top = { i, j, v };
      })
    );
    const topText = top
      ? `Top correlation: ${input.labels[top.i]} vs ${input.labels[top.j]} = ${top.v.toFixed(2)}`
      : '';
    const overlayBase = data.map(([i, j, v]) => [i, j, Math.abs(v) * 20]);
    const full = this.repeatToN(overlayBase, 1000);
    const shown = Math.min(200, full.length);
    return {
      option: {
        title: { text: 'Correlation Matrix' },
        tooltip: { position: 'top' },
        xAxis: { type: 'category', data: input.labels },
        yAxis: { type: 'category', data: input.labels },
        visualMap: { min: -1, max: 1, orient: 'horizontal', left: 'center', bottom: 0 },
        graphic: topText
          ? [
              {
                type: 'text',
                left: 10,
                top: 10,
                style: { text: topText, fill: '#cfd8dc', fontSize: 12 },
              },
            ]
          : [],
        dataZoom: [{ type: 'inside' }, { type: 'slider' }],
        series: [
          { type: 'heatmap', data, progressive: 0 },
          {
            type: 'scatter',
            data: full.slice(0, shown),
            symbolSize: (d: any) => d[2],
            itemStyle: {
              color: (params: any) =>
                input.matrix[params.data[1]][params.data[0]] >= 0 ? '#42a5f5' : '#ef5350',
            },
          },
        ],
      },
      progressive: [{ idx: 1, full, shown }],
      step: 200,
    };
  }

  private swarmPlot(input: { groups: string[]; values: Record<string, number[]> }): {
    option: EChartsCoreOption;
    progressive: Array<{ idx: number; full: any[]; shown: number }>;
    step: number;
  } {
    const series: any[] = [];
    const prog: Array<{ idx: number; full: any[]; shown: number }> = [];
    const perSeriesTarget = Math.ceil(1000 / Math.max(1, input.groups.length));
    const perSeriesShown = Math.max(1, Math.floor(200 / Math.max(1, input.groups.length)));
    input.groups.forEach((g, idx) => {
      const base = (input.values[g] ?? []).map((v) => [idx + 1 + (Math.random() - 0.5) * 0.6, v]);
      const full = this.expandToN(base, perSeriesTarget, 0.6, 0.8);
      const shown = Math.min(perSeriesShown, full.length);
      series.push({ name: g, type: 'scatter', data: full.slice(0, shown), symbolSize: 8 });
      prog.push({ idx: series.length - 1, full, shown });
    });
    const all = input.groups.flatMap((g) => input.values[g] ?? []);
    const med = this.median(all);
    return {
      option: {
        title: { text: 'Swarm Plot (jittered)' },
        tooltip: { trigger: 'item' },
        xAxis: {
          name: 'Group',
          type: 'value',
          min: 0,
          max: input.groups.length + 1,
          axisLabel: { formatter: (v: number) => input.groups[v - 1] ?? '' },
        },
        yAxis: { name: 'Value' },
        dataZoom: [{ type: 'inside' }, { type: 'slider' }],
        series: [
          ...series,
          {
            type: 'line',
            name: 'Median',
            data: [
              [0, med],
              [input.groups.length + 1, med],
            ],
            symbol: 'none',
            lineStyle: { type: 'dashed', color: '#ab47bc' },
          },
        ],
      },
      progressive: prog,
      step: 200,
    };
  }

  // Helpers
  private buildExamInfo(patientId: string, d: any | null) {
    const meta = d?.meta;
    if (meta?.examDate || meta?.hrBpm || meta?.bp || meta?.efPct || meta?.diagnosis) {
      return {
        date: meta.examDate ?? new Date().toISOString().slice(0, 10),
        hrBpm: meta.hrBpm ?? 72,
        bp: meta.bp ?? '120/78',
        efPct: meta.efPct ?? this.estimateEf(d),
        diagnosis: meta.diagnosis ?? (this.estimateEf(d) < 40 ? 'HFrEF' : 'Normal'),
      };
    }
    const rng = this.seededRandom(patientId);
    const daysAgo = Math.floor(rng() * 120);
    const dt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
    const ef = Math.round((this.estimateEf(d) || 55) * 10) / 10;
    const hr = Math.round(60 + rng() * 40);
    const sys = Math.round(110 + rng() * 30);
    const dia = Math.round(70 + rng() * 20);
    const diag = ef < 40 ? 'HFrEF (reduced EF)' : ef < 55 ? 'Borderline EF' : 'Normal EF';
    return {
      date: dt.toISOString().slice(0, 10),
      hrBpm: hr,
      bp: `${sys}/${dia}`,
      efPct: ef,
      diagnosis: diag,
    };
  }

  private estimateEf(d: any | null): number {
    const arr = d?.scatter as Array<{ ef: number }> | undefined;
    if (!arr?.length) return 55;
    const vals = arr.map((x) => x.ef).filter((x) => Number.isFinite(x));
    if (!vals.length) return 55;
    return Math.round((this.median(vals) || 55) * 10) / 10;
  }

  private median(arr: number[]): number {
    if (!arr?.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  private seededRandom(seedStr: string) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let state = h >>> 0;
    return function () {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Build 1000-point datasets with jitter and provide helpers for reveal
  private expandToN(
    base: any[],
    target: number,
    jitterX = 0.5,
    jitterY = 0.5,
    bubble = false
  ): any[] {
    if (!Array.isArray(base) || base.length === 0) return [];
    const rng = this.seededRandom('chart-augment');
    const out: any[] = [];
    const bx = base.map((p) => p[0]);
    const by = base.map((p) => p[1]);
    const minX = Math.min(...bx),
      maxX = Math.max(...bx);
    const minY = Math.min(...by),
      maxY = Math.max(...by);
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    for (let i = 0; i < target; i++) {
      const src = base[i % base.length];
      const jx = (rng() - 0.5) * jitterX * dx * 0.02; // up to ~2% of range
      const jy = (rng() - 0.5) * jitterY * dy * 0.02;
      if (bubble) {
        const jr = 1 + (rng() - 0.5) * 0.1; // +/-10%
        out.push([src[0] + jx, src[1] + jy, Math.max(1, src[2] * jr)]);
      } else {
        out.push([src[0] + jx, src[1] + jy, ...src.slice(2)]);
      }
    }
    return out;
  }

  private repeatToN(base: any[], target: number): any[] {
    if (!Array.isArray(base) || base.length === 0) return [];
    const out: any[] = [];
    for (let i = 0; i < target; i++) out.push(base[i % base.length]);
    return out;
  }
}
