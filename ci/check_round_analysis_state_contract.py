from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'components/round-detail.tsx').read_text(encoding='utf-8')
checks={
 'RoundDetail forwards immutable update callback to AI analysis':'onRoundUpdated={onRoundUpdated}' in s,
 'AI analysis declares update callback prop':'function AiAnalysis({ round, priorRounds, userEmail, onRoundUpdated }' in s,
 'AI save synchronizes parent immutably':'onRoundUpdated?.({ ...round, ai_analysis: analysis })' in s,
 'AI save does not mutate round prop':'round.ai_analysis = analysis' not in s,
}
fail=[k for k,v in checks.items() if not v]
if fail:
 print('Round analysis state contract: FAIL')
 for x in fail: print(' -',x)
 raise SystemExit(1)
print('Round analysis state contract: PASS')
