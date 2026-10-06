import { Pill } from '../../../../ui';

type Skill = { dimension_id: string; name: string; score: number; max_score: number; level_label: string | null; weight_percent: number; points: number; percent_of_section: number; status: string };
export type Sheet = { final_percent: number; band_label: string; base_percent: number; capped: boolean; adjustments: string[]; skills: Skill[]; bands: { label: string; lower: number; upper: number }[] };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The graded assessment's result: overall score and band, and per skill the weight, the 1–5
 * score and the weighted points it contributed. No coaching, evidence or transcript.
 */
export function ScoreSheet({ sheet, underReview }: { sheet: Sheet | null; underReview: boolean }) {
  if (!sheet) return <div className="note mb">No score was produced for this assessment.</div>;
  const total = sheet.skills.reduce((n, s) => n + s.points, 0);
  return <>
    {underReview && <div className="note warn mb"><strong>Under review.</strong> The assessor flagged something a reviewer must confirm. This score may still change.</div>}
    {sheet.capped && <div className="note mb">The score was capped at {sheet.final_percent} (from {fmt(sheet.base_percent)}) because of a serious risky statement.</div>}
    <section className="card mb"><div className="card-head"><h2>Score by skill</h2><span className="small muted">Each skill is scored 1–5; its weighted points add up to the overall score</span></div><div className="card-body tight"><div className="tblwrap"><table>
      <thead><tr><th>Skill</th><th className="num">Weight</th><th>Your score</th><th className="num">Weighted points</th><th className="num">Of this section</th></tr></thead>
      <tbody>
        {sheet.skills.map((s, i) => <tr key={s.dimension_id}>
          <td><strong>{i + 1}. {s.name}</strong></td>
          <td className="num">{fmt(s.weight_percent)}%</td>
          <td>{s.status === 'not_scored' ? <Pill>not scored</Pill> : <><strong>{s.score}/{s.max_score}</strong>{s.level_label && <span className="small muted"> · {s.level_label}</span>}</>}</td>
          <td className="num">{fmt(s.points)} <span className="small muted">of {fmt(s.weight_percent)}</span></td>
          <td className="num">{s.percent_of_section}%</td>
        </tr>)}
        <tr><td><strong>Total</strong></td><td className="num">100%</td><td /><td className="num"><strong>{fmt(Math.round(total * 10) / 10)}</strong> <span className="small muted">of 100</span></td><td /></tr>
      </tbody>
    </table></div>
      <p className="mt"><strong>Overall: {sheet.final_percent}/100 · {sheet.band_label}.</strong> <span className="small muted">{[...sheet.bands].reverse().map((x) => `${x.lower === 0 ? `below ${x.upper}` : `${x.lower}–${x.upper === 100 ? 100 : x.upper - 1}`} = ${x.label}`).join(', ')}.</span></p>
    </div></section>
  </>;
}
