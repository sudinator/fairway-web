# Workflow Simulation Report 177.37.260815

Evidence labels: MODELLED unless explicitly marked EXECUTED.

| Scenario | Expected result | Evidence |
|---|---|---|
| Manual run with NO mutation acknowledgement | Harness refuses before mutation | MODELLED from workflow/harness contract |
| Manual run with YES against staging | Harness may proceed | MODELLED |
| URL points at Production project ref | Harness refuses before service client construction | MODELLED |
| `staging -> main` PR | Existing required CI / verify job runs the real staging integration step | MODELLED |
| PR to main from another branch | Destructive staging job is skipped | MODELLED |
| Expense fixtures create audit rows | Cleanup deletes expenses, then audit rows | MODELLED |
| Expense deletion emits final audit row | Subsequent audit purge removes it | MODELLED from 0111 trigger ordering |
| Audit cleanup/delete fails | Harness cleanup throws and gate fails | MODELLED |
| Audit rows remain after cleanup | Harness throws and gate fails | MODELLED |
| Primary integration assertion fails | `finally` still invokes cleanup | MODELLED |

Real Supabase execution remains required before release.
