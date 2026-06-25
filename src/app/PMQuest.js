"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { signIn, signUp, signOut, getSession, getAccessToken, onAuthChange } from "@/lib/auth";
import { loadRemoteState, saveProfile, recordSolved, issueCertificate } from "@/lib/db";

const DOMAINS = [
  { key:'risk',   label:'Risk Management',   icon:'⚠︎' },
  { key:'stake',  label:'Stakeholder Comms', icon:'◎' },
  { key:'plan',   label:'Planning & Gantt',  icon:'▦' },
  { key:'agile',  label:'Agile Delivery',    icon:'⟳' },
  { key:'budget', label:'Budget & EVM',      icon:'◈' },
];

/* ============================== SCENARIO BANK ============================== */
const SCENARIOS = [
  { id:'p1', stage:1, free:true, domain:'plan', difficulty:1, title:`What Belongs in a Work Package`, chart:'gantt',
    prompt:`You're decomposing a WBS for an app launch. The team debates how granular to go. One member wants a single 200-hour "Build the app" block; another wants 400 tasks of 15 minutes each. The sponsor just wants "something on a chart". What's the right level for a work package?`,
    options:[ {t:`One big 200-hour block — fewer things to track`,correct:false},{t:`A package small enough to estimate and assign, but big enough to be meaningful (e.g. the 8–80 hour guideline)`,correct:true},{t:`15-minute tasks so nothing is missed`,correct:false},{t:`Whatever the sponsor finds easiest to read`,correct:false} ],
    coach:`Too coarse and you can't estimate or track it; too fine and you drown in admin. There's a sweet spot.`,
    why:`A good work package is small enough to estimate, assign an owner, and track — the common heuristic is the 8–80 hour rule. 200 hours hides risk; 15-minute tasks create overhead with no insight.`,
    better:`Decompose until each package has a clear deliverable, owner, and estimate — then stop. The WBS is for control, not bureaucracy.`, badge:null },
  { id:'p2', stage:1, free:true, domain:'plan', difficulty:2, title:`The Hidden Critical Path`, chart:'gantt',
    prompt:`A 6-week website rebuild has four work packages. Design (5d) must finish before Front-end build (8d). Content writing (6d) runs in parallel and feeds the build. The sponsor keeps asking about the logo refresh (2d), which can happen any time. QA (4d) needs the build done. The CEO mentioned she "likes blue." With one extra developer for ONE package, where do you apply them to pull the finish date in?`,
    options:[ {t:`The logo refresh — it's what the sponsor keeps asking about`,correct:false},{t:`Front-end build — it's on the critical path and longest in the dependent chain`,correct:true},{t:`Content writing — writers always run late`,correct:false},{t:`QA — quality should never be rushed`,correct:false} ],
    coach:`Strip the noise (the logo, the CEO's colour taste). Which task, if shortened, actually moves the END date?`,
    why:`The critical path is Design→Build→QA. Build is the longest task on that chain, so crashing it shortens the whole project. Logo and content have float and don't drive the finish.`,
    better:`Always identify the critical path before crashing. Adding resources off it burns budget without moving the date — and watch for a new critical path emerging.`, badge:'Path Finder' },
  { id:'p3', stage:2, free:true, domain:'plan', difficulty:3, title:`Crash or Fast-Track?`, chart:'gantt',
    prompt:`You're 9 days behind on a fixed date. Two compression options: (1) Crash — add two contractors to testing for +$40k. (2) Fast-track — start UAT before the build is fully done, overlapping them. Budget is tight; the build team is already stretched. What's the key trade-off to weigh first?`,
    options:[ {t:`Crashing always beats fast-tracking — just pay for speed`,correct:false},{t:`Crashing adds cost; fast-tracking adds rework risk from overlapping dependent work — choose based on which you can absorb`,correct:true},{t:`Fast-track everything; it's free`,correct:false},{t:`Neither — tell the sponsor the date is impossible`,correct:false} ],
    coach:`Crashing costs money. Fast-tracking costs rework risk. Which constraint is tighter for you right now?`,
    why:`Crashing (more resources) increases cost; fast-tracking (overlapping sequential work) increases the risk of rework. With a tight budget but a hard date, fast-tracking may be viable IF the overlap risk is managed.`,
    better:`Quantify both: cost of crashing vs. expected rework cost of fast-tracking. Often a blend on the critical path is optimal.`, badge:null },
  { id:'p4', stage:3, free:true, domain:'plan', difficulty:3, title:`The Three-Point Estimate`, chart:null,
    prompt:`A developer says a module is "about 10 days." Pressed, she admits best case is 6, and if the third-party API is flaky it could hit 24. Leadership wants one number for the plan. Using PERT (O+4M+P)/6, what expected duration do you put in the schedule?`,
    options:[ {t:`10 days — that was her first answer`,correct:false},{t:`≈11.7 days — (6 + 4×10 + 24) / 6`,correct:true},{t:`24 days — always plan for the worst`,correct:false},{t:`6 days — assume it goes well`,correct:false} ],
    coach:`PERT weights the most-likely estimate heavily but still accounts for the long tail. Plug in O=6, M=10, P=24.`,
    why:`PERT expected = (O + 4M + P)/6 = (6 + 40 + 24)/6 = 70/6 ≈ 11.7 days. More honest than a single guess because it incorporates the pessimistic tail.`,
    better:`Use three-point estimates for uncertain tasks and aggregate the variance to size your schedule reserve.`, badge:null },
  { id:'p5', stage:4, free:false, domain:'plan', difficulty:4, title:`Crisis · The Missed Dependency`, chart:'gantt',
    prompt:`Two weeks in, you discover the data-migration task (10d) was never linked as a predecessor to go-live — and it can only start after the new schema is signed off, which is itself waiting on legal. Go-live is in 5 weeks. The team is busy on lower-priority polish. BEST first move?`,
    options:[ {t:`Keep going and hope migration fits somehow`,correct:false},{t:`Re-baseline the network: insert the real dependency, recompute the critical path, and escalate the legal sign-off as the blocker`,correct:true},{t:`Skip the schema sign-off to save time`,correct:false},{t:`Move polish work earlier since the team is free`,correct:false} ],
    coach:`A missing dependency means your critical path is wrong. Fix the network first, then act on what it reveals.`,
    why:`The migration is now likely on the critical path and gated by legal. Correct the schedule logic, surface the true critical path, and drive the actual blocker (legal sign-off) rather than busying the team on float work.`,
    better:`Validate dependencies early and continuously. A hidden predecessor is a schedule landmine — re-baseline transparently and manage the binding constraint.`, badge:'Schedule Surgeon' },
  { id:'r1', stage:1, free:true, domain:'risk', difficulty:2, title:`Choose the Risk Response`, chart:'risk',
    prompt:`A regulatory change might force a costly redesign late in the project — moderate probability, high impact, and largely outside your control. Mitigation would be expensive and only partly effective. Which risk response strategy fits best?`,
    options:[ {t:`Accept it — risks are part of projects`,correct:false},{t:`Transfer it — e.g. a contractual clause or insurance so the cost/impact shifts to a third party`,correct:true},{t:`Avoid it by cancelling the project`,correct:false},{t:`Ignore it until it happens`,correct:false} ],
    coach:`Four responses for threats: avoid, transfer, mitigate, accept. Which fits a high-impact risk you can't cheaply reduce or control?`,
    why:`When impact is high and you can't cost-effectively reduce or control it, transfer (insurance, warranties, contract clauses) shifts the financial impact to a party better placed to bear it.`,
    better:`Match the response to the risk: avoid the cause, transfer the impact, mitigate the likelihood/impact, or accept with reserve. Don't default to "mitigate".`, badge:null },
  { id:'r2', stage:2, free:true, domain:'risk', difficulty:3, title:`The Risk Register Triage`, chart:'risk',
    prompt:`Four risks sit in your register. (A) 10% chance of an API price hike adding $80k. (B) 70% chance a junior tester takes pre-booked holiday, ~2 days lost. (C) 15% chance your single cloud region has an outage halting launch — ~$200k impact. (D) 60% chance of minor UI copy rework, ~$1k. Budget allows you to actively mitigate ONE now. Which has the highest expected monetary value (EMV)?`,
    options:[ {t:`B — it's the most likely (70%)`,correct:false},{t:`C — 15% × $200k = $30k EMV, the largest exposure`,correct:true},{t:`A — vendors can't be trusted`,correct:false},{t:`D — it's cheap to just fix`,correct:false} ],
    coach:`EMV = probability × impact. Don't anchor on probability alone — a rare catastrophe can outrank a frequent nuisance.`,
    why:`EMV: A=$8k, B≈small, C=$30k, D=$0.6k. The single-region outage carries the largest expected loss, so a contingency (multi-region) gives the best risk-reduction per dollar.`,
    better:`Quantify exposure (EMV) rather than reacting to the loudest or most frequent risk. High-impact tail risks justify contingency even at low probability.`, badge:'Risk Whisperer' },
  { id:'r3', stage:3, free:true, domain:'risk', difficulty:3, title:`The Zero-Risk Sponsor`, chart:null,
    prompt:`Your sponsor declares "I want zero risk on this project." It's a first-of-its-kind product on a tight timeline with a new tech stack. He's serious and a little anxious. How do you respond as the PM?`,
    options:[ {t:`Agree and promise zero risk to keep him calm`,correct:false},{t:`Reframe: surface the risk profile, align on an acceptable risk appetite/threshold, and show the reserve and responses that manage it`,correct:true},{t:`Tell him innovation is impossible without risk and move on`,correct:false},{t:`Pad every estimate so nothing can ever slip`,correct:false} ],
    coach:`Zero risk is impossible on a novel project. Your job isn't to promise it away — it's to make risk visible and managed.`,
    why:`You can't eliminate risk on a novel, time-boxed effort. The professional move is to establish risk appetite/thresholds, present the register with responses and reserves, and let the sponsor make informed trade-offs.`,
    better:`Translate anxiety into a shared risk appetite. Transparency plus a credible response plan builds more trust than an impossible promise.`, badge:null },
  { id:'r4', stage:4, free:false, domain:'risk', difficulty:4, title:`Crisis · The Secondary Risk`, chart:'risk',
    prompt:`To mitigate a vendor-delay risk, you propose switching to an in-house build. Engineering points out this introduces a NEW risk: the in-house team lacks payments-compliance expertise, which could fail an audit. The sponsor likes the in-house plan. What must you do before committing?`,
    options:[ {t:`Proceed — the original risk is solved`,correct:false},{t:`Log and assess the secondary (and any residual) risk; only commit if net exposure actually drops`,correct:true},{t:`Hide the compliance concern so the plan isn't blocked`,correct:false},{t:`Switch back to the vendor regardless`,correct:false} ],
    coach:`Every response can spawn a new risk. A mitigation that creates a bigger threat isn't a mitigation.`,
    why:`Risk responses generate secondary risks (here, a compliance/audit failure) and leave residual risk. You must evaluate whether the net exposure after the response is genuinely lower before committing.`,
    better:`Always assess secondary and residual risk. Choose the response that minimises total exposure, not just the original threat.`, badge:null },
  { id:'r5', stage:5, free:false, domain:'risk', difficulty:5, title:`Capstone · The Single Point of Failure`, chart:'risk',
    prompt:`Your launch depends entirely on one boutique vendor integrating their payments SDK by week 10. They've slipped two minor deadlines, comms are slow, and they're the only vendor your sponsor pre-approved. A competing SDK exists but needs 3 weeks to integrate and sponsor sign-off. You have 4 weeks of float. Mitigation vs. contingency — strongest move?`,
    options:[ {t:`Keep pressuring the vendor — switching looks panicky`,correct:false},{t:`Run a parallel spike on the alternate SDK now (contingency) while tightening vendor governance (mitigation), and brief the sponsor on the switch trigger`,correct:true},{t:`Switch to the alternate SDK immediately`,correct:false},{t:`Log it and revisit next month`,correct:false} ],
    coach:`A single point of failure with a slipping owner. What reduces the threat AND gives a tested fallback before the float runs out?`,
    why:`This is mitigation (tighter vendor governance) plus contingency (a parallel, pre-validated fallback with a defined trigger). Within 4 weeks of float you can de-risk without prematurely abandoning the approved vendor or gambling on one thread.`,
    better:`For critical single points of failure, define the decision trigger in advance and run the fallback far enough to be real. Get the sponsor to own the switch criteria.`, badge:'Contingency Architect' },
  { id:'s1', stage:1, free:true, domain:'stake', difficulty:2, title:`Power / Interest Grid`, chart:'raci',
    prompt:`A regional director has huge influence over your budget but has shown almost no interest in your project so far. On the power/interest grid she's high-power, low-interest. How should you engage her?`,
    options:[ {t:`Manage closely — daily updates and every detail`,correct:false},{t:`Keep her satisfied — concise, periodic executive updates; engage actively only when needed`,correct:true},{t:`Ignore her since she's not interested`,correct:false},{t:`Only inform her after launch`,correct:false} ],
    coach:`High power, low interest. You don't want to over-communicate and annoy her — but you can't let her get blindsided.`,
    why:`High-power/low-interest stakeholders should be "kept satisfied": enough high-level visibility to prevent surprises, without drowning them in detail that erodes goodwill.`,
    better:`Tailor engagement to grid position: manage close (high/high), keep satisfied (high/low), keep informed (low/high), monitor (low/low).`, badge:null },
  { id:'s2', stage:2, free:true, domain:'stake', difficulty:3, title:`The Backchannel Request`, chart:'raci',
    prompt:`Mid-sprint, a senior VP emailed one of your developers directly asking her to "just quickly add" an export feature — and she's already started. It's not in the backlog, not estimated, and the sprint is full. The VP is influential but not the sponsor. The dev is stressed. The sponsor expects the committed scope Friday. BEST first move?`,
    options:[ {t:`Let the dev finish quietly — the VP is senior`,correct:false},{t:`Ask the dev to pause, route the request through change control, and protect the sprint commitment`,correct:true},{t:`Escalate to HR about the VP`,correct:false},{t:`Drop a committed item to fit it in`,correct:false} ],
    coach:`Two problems: an unmanaged scope change and a broken decision path. Fix the process without burning the relationship.`,
    why:`Unestimated work entering a full sprint is scope creep. Redirect it through change control (impact assessed, sponsor prioritises) and protect the team's commitment — don't silently absorb it or start a fight.`,
    better:`Reaffirm the RACI: requests flow through the PM/change process. Acknowledge the VP's need, quantify the trade-off, let the sponsor decide.`, badge:'Stakeholder Diplomat' },
  { id:'s3', stage:3, free:true, domain:'stake', difficulty:3, title:`Two Bosses, Two Priorities`, chart:null,
    prompt:`Sales insists the feature ships next week to close a deal. Legal insists it can't ship without a compliance review that takes two weeks. Both are powerful, both have escalated to you, both believe they're right. BEST path?`,
    options:[ {t:`Side with Sales — revenue wins`,correct:false},{t:`Facilitate a joint decision: surface the trade-off and risk to both, then escalate to the sponsor/steering group for a priority call if unresolved`,correct:true},{t:`Side with Legal — compliance always wins`,correct:false},{t:`Ship it and ask forgiveness later`,correct:false} ],
    coach:`This isn't yours to unilaterally decide. Make the trade-off explicit and route it to the right authority.`,
    why:`Conflicting powerful stakeholders need a structured trade-off, not a PM picking sides. Bring them together, quantify revenue vs. compliance risk, and escalate to the decision owner if they can't align.`,
    better:`Use a confronting/problem-solving style: shared data, shared room, clear decision authority. Avoid forcing or smoothing.`, badge:null },
  { id:'s4', stage:4, free:false, domain:'stake', difficulty:4, title:`Crisis · Delivering Bad News`, chart:null,
    prompt:`A key integration just failed testing; the launch will slip three weeks. The steering committee meets in an hour. Marketing has pre-booked ads for the original date. BEST way to handle the committee?`,
    options:[ {t:`Downplay it as a "minor delay" to avoid panic`,correct:false},{t:`Present the issue, root cause, revised date, options with trade-offs, and your recommendation — proactively`,correct:true},{t:`Skip the meeting until you have better news`,correct:false},{t:`Blame the integration vendor publicly`,correct:false} ],
    coach:`Executives forgive bad news far more than surprises or spin. Come with facts, options, and a recommendation.`,
    why:`Proactive, honest disclosure with root cause, a credible revised plan, and options (including the marketing impact) preserves credibility and lets the committee decide. Hiding or minimising destroys trust when it surfaces.`,
    better:`Bring decisions, not just problems: 2–3 options with cost/schedule/risk trade-offs and a clear recommendation.`, badge:'Truth Teller' },
  { id:'s5', stage:4, free:false, domain:'stake', difficulty:4, title:`Crisis · Drowning in Reports`, chart:null,
    prompt:`A nervous executive now demands a detailed written status report every single day. Producing it eats ~90 minutes of your team's time daily and he admits he "skims it." Velocity is dropping. How do you respond?`,
    options:[ {t:`Comply fully — he's an executive`,correct:false},{t:`Understand the underlying concern, then propose a lighter cadence/dashboard that meets his real need without draining the team`,correct:true},{t:`Refuse outright`,correct:false},{t:`Have a junior fabricate the reports quickly`,correct:false} ],
    coach:`A daily report request is usually a symptom of a fear, not a real information need. Solve the fear.`,
    why:`Over-reporting is waste. Diagnose what reassurance he actually needs, then meet it efficiently — e.g. a live dashboard plus a brief weekly review — protecting team capacity while keeping him satisfied.`,
    better:`Treat reporting demands as a stakeholder signal. Right-size communication to the real need; automate where possible.`, badge:null },
  { id:'a1', stage:1, free:true, domain:'agile', difficulty:2, title:`Scope Added Mid-Sprint`, chart:'burndown',
    prompt:`Three days into a two-week sprint, the product owner wants to inject a "small" new story because a client asked. The sprint backlog is already full and the goal is set. By the book, what's the right Scrum response?`,
    options:[ {t:`Just add it — the client is important`,correct:false},{t:`Protect the sprint goal: add it to the product backlog for the PO to prioritise into a future sprint (or renegotiate only if the goal is at risk)`,correct:true},{t:`Add it and extend the sprint by a few days`,correct:false},{t:`Let the team decide silently`,correct:false} ],
    coach:`The sprint goal is a commitment. New work goes to the backlog, not mid-sprint, unless the goal itself changes.`,
    why:`Scrum protects the sprint goal. New requests belong in the product backlog for the PO to prioritise. Only the PO can renegotiate scope, and only if the goal becomes obsolete.`,
    better:`Shield the team from mid-sprint churn. Make the trade-off visible: adding now means dropping something or risking the goal.`, badge:null },
  { id:'a2', stage:2, free:true, domain:'agile', difficulty:2, title:`The Oversized Story`, chart:null,
    prompt:`A single user story is estimated at 21 points — bigger than the team's entire historical sprint velocity of ~20. The PO wants it "done this sprint." Right move?`,
    options:[ {t:`Commit to it and push hard`,correct:false},{t:`Split it into smaller, independently valuable slices that fit and can be demoed`,correct:true},{t:`Carry it across three sprints as one item`,correct:false},{t:`Re-estimate it lower to make it fit`,correct:false} ],
    coach:`A story larger than your velocity can't be delivered or even safely estimated. What do good stories do?`,
    why:`Stories should be small, independent, and demoable (INVEST). A 21-point monolith should be vertically sliced into thin, valuable increments — not crammed in, stretched across sprints as one item, or fudged in estimation.`,
    better:`Split by workflow steps or business rules so each slice delivers value and reduces uncertainty.`, badge:null },
  { id:'a3', stage:3, free:true, domain:'agile', difficulty:3, title:`The Velocity Trap`, chart:'burndown',
    prompt:`Sprint planning. Leadership wants 8 features for a marketing campaign. Your velocity over 4 sprints was 22, 19, 24, 21. The 8 features total 38 points. The PO says "let's just commit and push." Two members are on a half-day training Thursday. What should you do?`,
    options:[ {t:`Commit to all 8 — leadership asked`,correct:false},{t:`Pull in ~21 points of highest-value features and have the PO re-sequence the rest with leadership`,correct:true},{t:`Commit to all 8 with mandatory overtime`,correct:false},{t:`Refuse to plan until expectations drop`,correct:false} ],
    coach:`Velocity is an empirical guide, not a target you can wish higher. ~21 is honest capacity — and it's a short week.`,
    why:`Average velocity ≈21 (lower with training). Committing to 38 sets up failure and delays the campaign anyway. Pulling the top-value ~21 and letting the PO re-sequence keeps delivery predictable.`,
    better:`Use historical velocity as a forecast, agree a clear sprint goal, and make scope trade-offs visible rather than absorbing them as overtime.`, badge:'Sprint Saver' },
  { id:'a4', stage:3, free:true, domain:'agile', difficulty:3, title:`The Flat Burndown`, chart:'burndown',
    prompt:`Five days into a 10-day sprint the burndown is almost flat — remaining work has barely moved, though the team says they're "busy and close on everything." Standups sound fine. Most likely problem and best response?`,
    options:[ {t:`Nothing — work always lands at the end`,correct:false},{t:`Too much WIP and no "done" items; enforce finishing stories (limit WIP) and inspect blockers`,correct:true},{t:`The estimates were too low; just re-estimate up`,correct:false},{t:`Add more people immediately`,correct:false} ],
    coach:`"Busy and close on everything" is the tell. Lots started, nothing finished. What does a flat line mid-sprint signal?`,
    why:`A flat burndown with everything "almost done" signals excessive work-in-progress — no stories reach Done. Limiting WIP and swarming to finish restores flow; piling on people or re-estimating doesn't fix the behaviour.`,
    better:`Track completed work, not activity. Enforce WIP limits and a strict Definition of Done so the burndown reflects reality.`, badge:null },
  { id:'a5', stage:4, free:false, domain:'agile', difficulty:4, title:`Crisis · The Absent Product Owner`, chart:null,
    prompt:`Your PO has been pulled into a company crisis and is unreachable for the third day. The team is blocked on prioritisation and acceptance decisions, and the sprint goal is now ambiguous. BEST action?`,
    options:[ {t:`Have developers guess priorities and keep coding`,correct:false},{t:`Escalate the PO availability as an impediment, get a delegated proxy with decision authority, and stabilise the current sprint scope`,correct:true},{t:`Make all product decisions yourself as PM`,correct:false},{t:`Pause the team until the PO returns`,correct:false} ],
    coach:`An absent PO is an organisational impediment. Who is empowered to make value/priority calls meanwhile?`,
    why:`PO unavailability is a real impediment to escalate. The fix is a delegated proxy with genuine decision authority, plus protecting the current sprint's stability — not guessing, not the PM seizing product authority, not idling the team.`,
    better:`Treat people-availability as a managed risk: pre-agree a PO proxy and decision SLAs so delivery doesn't stall.`, badge:null },
  { id:'a6', stage:4, free:false, domain:'agile', difficulty:5, title:`Crisis · The 30% Budget Cut`, chart:'risk',
    prompt:`Two sprints from a fixed launch, the sponsor pulls 30% of remaining budget but won't move the date or reduce headline scope publicly. The team is already at full, sustainable velocity. Marketing has announced the date. Engineering is quietly worried about a fragile payments module. BEST path?`,
    options:[ {t:`Mandate overtime and weekend work to hold all scope`,correct:false},{t:`Co-run an MVP re-prioritisation with the sponsor: protect must-haves (payments), defer low-value scope, communicate the trade-off`,correct:true},{t:`Keep the plan and silently absorb the overrun`,correct:false},{t:`Cut testing on payments to save time and money`,correct:false} ],
    coach:`Time and team are fixed and money just dropped. Of scope, schedule, cost, quality — which lever is left that doesn't burn people or quality?`,
    why:`With date and capacity fixed, scope is the only humane, sustainable lever. Co-prioritising to an MVP protects the highest-value and highest-risk work (payments) and makes the cut explicit. Overtime and skipping tests trade short-term optics for real risk.`,
    better:`Frame it as value-based MVP delivery, defend the fragile payments path, and surface the trade-off in writing so the date/scope reality is owned by the sponsor.`, badge:'Crisis Commander' },
  { id:'b1', stage:2, free:true, domain:'budget', difficulty:3, title:`Reserve vs. Reserve`, chart:null,
    prompt:`You've identified $30k of EMV across known risks and want a buffer. The sponsor asks whether this goes in the cost baseline or sits above it, and who can authorise spending it. What's correct?`,
    options:[ {t:`It's management reserve, above the baseline, and the PM spends it freely`,correct:false},{t:`It's contingency reserve for known risks — inside the cost baseline, controlled by the PM; management reserve (unknowns) sits above and needs management approval`,correct:true},{t:`Both reserves are the same thing`,correct:false},{t:`Neither belongs in the budget`,correct:false} ],
    coach:`Known-unknowns vs unknown-unknowns. One lives in the baseline; the other above it. Who controls each?`,
    why:`Contingency reserve covers identified risks and is part of the cost baseline, managed by the PM. Management reserve covers unforeseen work, sits above the baseline, and needs management authorisation to release.`,
    better:`Size contingency from your risk analysis (e.g. EMV) and keep it distinct from management reserve in your budget structure.`, badge:null },
  { id:'b2', stage:4, free:false, domain:'budget', difficulty:4, title:`Crisis · The EVM Diagnosis`, chart:'evm',
    prompt:`You're 40% through a $500k, 20-week project. The dashboard shows: Planned Value $220k, Earned Value $180k, Actual Cost $230k. The sponsor, also pushing an unrelated feature, asks: "Just tell me — are we fine?" Ignore the feature ask. Honest diagnosis?`,
    options:[ {t:`Fine — we've spent about what we planned`,correct:false},{t:`Behind schedule AND over budget: SPI 0.82, CPI 0.78 — projected ~$640k at completion`,correct:true},{t:`Ahead of schedule, slightly over budget`,correct:false},{t:`Over budget but ahead of schedule, nets out`,correct:false} ],
    coach:`SPI = EV/PV. CPI = EV/AC. Both under 1 is the danger zone. EAC ≈ BAC / CPI.`,
    why:`SPI = 180/220 = 0.82 (behind). CPI = 180/230 = 0.78 (over budget). EAC = 500/0.78 ≈ $641k — a ~$141k overrun. Both indices under 1 means corrective action now.`,
    better:`Report variance early with the EAC forecast, then propose options (re-baseline, de-scope, or add funding). Don't let an unrelated ask distract from a confirmed overrun.`, badge:'EVM Analyst' },
  { id:'b3', stage:5, free:false, domain:'budget', difficulty:4, title:`Capstone · The EAC Forecast`, chart:'evm',
    prompt:`Mid-project: BAC $800k, and current CPI is a steady 0.90 driven by a systemic productivity issue you don't expect to improve. The sponsor asks for a realistic estimate at completion to take to the board. Which EAC is most defensible?`,
    options:[ {t:`$800k — we'll make it up later`,correct:false},{t:`≈ $889k — BAC / CPI, since the overrun is systemic and likely to continue`,correct:true},{t:`$720k — assume efficiency improves`,correct:false},{t:`Impossible to forecast`,correct:false} ],
    coach:`When the cost variance is systemic (not a one-off), the typical-performance formula EAC = BAC / CPI applies.`,
    why:`For a systemic, continuing variance, EAC = BAC/CPI = 800/0.90 ≈ $889k. Assuming you'll "make it up" (EAC=BAC) is wishful; a lower figure ignores the established trend.`,
    better:`Choose the EAC formula that matches reality: BAC/CPI for typical/continuing variance; AC + (BAC−EV) only when the variance was atypical.`, badge:null },
  { id:'b4', stage:5, free:false, domain:'budget', difficulty:5, title:`Capstone · The Sunk Cost Trap`, chart:'evm',
    prompt:`A struggling project has consumed $1.2M of its $1.5M budget. To finish needs another $900k (so ~$2.1M total) and the market window has half-closed, cutting projected returns below the remaining cost. A senior leader says "we've already spent $1.2M, we can't stop now." Right basis for the decision?`,
    options:[ {t:`Continue — we can't waste the $1.2M already spent`,correct:false},{t:`Decide on forward-looking economics: the $1.2M is sunk; compare the remaining $900k cost against the now-reduced expected benefit`,correct:true},{t:`Continue because cancelling looks bad`,correct:false},{t:`Always cancel projects that go over budget`,correct:false} ],
    coach:`The money already spent can't be recovered by continuing. What matters is future cost vs. future benefit.`,
    why:`Sunk costs are irrelevant to the go/no-go decision. With remaining cost ($900k) now exceeding the reduced expected benefit, the rational choice is to stop or pivot — regardless of the $1.2M already spent.`,
    better:`Frame continuation decisions on remaining cost vs. remaining benefit. Name the sunk-cost fallacy explicitly when leaders invoke it.`, badge:'Cool-Headed Closer' },
];
const MENTOR = "Coach Mira";
const FREE_COUNT = SCENARIOS.filter(s=>s.free).length;
const EXAM_IDS = ['p2','r2','s2','a3','b2','p5','a6','b4'];

/* ============================== AI HELPER ============================== */
const GLOSSARY = [
  ['critical path',`The critical path is the longest chain of dependent tasks — it sets the project's finish date. Shortening a task on it pulls the date in; shortening one off it (with float) doesn't.`],
  ['float',`Float (or slack) is how long a task can slip without delaying the project. Tasks on the critical path have zero float.`],
  ['emv',`Expected Monetary Value = probability × impact. It lets you compare risks fairly — a rare but catastrophic risk can outrank a frequent trivial one.`],
  ['cpi',`CPI = Earned Value / Actual Cost. Below 1.0 means you're over budget (getting less value per dollar than planned).`],
  ['spi',`SPI = Earned Value / Planned Value. Below 1.0 means you're behind schedule.`],
  ['eac',`Estimate at Completion forecasts the final cost. For a systemic overrun, EAC = BAC / CPI.`],
  ['velocity',`Velocity is the average story points a team completes per sprint. Use it as a forecast, not a target you can inflate.`],
  ['raci',`RACI assigns who is Responsible, Accountable, Consulted, Informed. The golden rule: exactly one Accountable per activity.`],
  ['scope creep',`Scope creep is uncontrolled growth of work without matching changes to time/budget. Route changes through change control.`],
  ['mitigation',`Mitigation reduces a risk's probability or impact. Contingency is a fallback plan you trigger if it happens anyway.`],
  ['contingency',`Contingency is a prepared fallback (with a trigger) for when a risk materialises — distinct from mitigation, which lowers the risk up front.`],
  ['burndown',`A burndown chart shows remaining work vs. the ideal pace. Above the line = behind; below = ahead.`],
  ['gantt',`A Gantt chart maps tasks against time and shows dependencies and the critical path.`],
  ['sunk cost',`Sunk costs are money already spent and unrecoverable. They should not influence whether to continue — only future cost vs. future benefit should.`],
  ['pert',`PERT estimate = (Optimistic + 4×Most-likely + Pessimistic) / 6. It accounts for the pessimistic tail.`],
  ['mvp',`A Minimum Viable Product is the smallest slice that delivers real value — your lever when time and budget are fixed.`],
  ['wip',`Work In Progress: too much of it stalls flow. Limiting WIP means finishing started work before pulling new work.`],
  ['baseline',`The baseline is the approved plan (scope/schedule/cost) you measure variance against. Re-baseline only through change control.`],
  ['reserve',`Contingency reserve covers known risks (inside the baseline, PM-controlled). Management reserve covers unknowns (above the baseline, management-approved).`],
];
function respondToQuestion(q, sc){
  const t=(q||'').toLowerCase();
  for(const [k,v] of GLOSSARY){ if(t.includes(k)) return v; }
  if(/what does|define|meaning|mean\b/.test(t)) return `I can explain any PM term — try naming it (e.g. "what is CPI?"). For this scenario: ${sc.coach}`;
  if(/which|answer|correct|best|should i pick/.test(t)) return `I won't give the answer away — but here's a nudge: ${sc.coach} Separate the real objective from the distractor details, then pick the option that protects it.`;
  return `Good question. ${sc.coach} Re-read the prompt and ignore the noise — what's the project's core objective here?`;
}

/* ============================== HELPERS ============================== */
function scoreFor(diff, firstTry, usedHint, fast){ let base=60+diff*20, mult=1; if(firstTry)mult*=1.4; if(fast)mult*=1.2; if(usedHint)base-=10; return Math.round(base*mult); }
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function useCountUp(target, dur=900){ const [v,setV]=useState(0); const ref=useRef(0);
  useEffect(()=>{ if(typeof window!=='undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){ setV(target); ref.current=target; return; } let raf,start; const from=ref.current; const step=(t)=>{ if(!start)start=t; const p=clamp((t-start)/dur,0,1); const e=1-Math.pow(1-p,3); setV(Math.round(from+(target-from)*e)); if(p<1)raf=requestAnimationFrame(step); else ref.current=target; }; raf=requestAnimationFrame(step); return ()=>cancelAnimationFrame(raf); },[target]); return v; }

/* ============================== PRIMITIVES ============================== */
function Bar({pct, tone='brand', h='h-2'}){ const grad=tone==='gold'?'linear-gradient(90deg,#e9c879,#f6e0a3)':tone==='health'?'linear-gradient(90deg,#fb7185,#4ade80)':'linear-gradient(90deg,#8b7cf0,#6d6bf5 50%,#5ec5ff)'; return <div className={`w-full ${h} rounded-full bg-white/[.07] overflow-hidden`}><div className={`bar ${h} rounded-full`} style={{width:pct+'%', background:grad}}/></div>; }
function Ring({pct, size=128, stroke=11, label, sub}){ const r=(size-stroke)/2, c=2*Math.PI*r, off=c-(pct/100)*c;
  return (<div className="relative inline-grid place-items-center" style={{width:size,height:size}}><svg width={size} height={size} className="-rotate-90"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#8b7cf0"/><stop offset="55%" stopColor="#6d6bf5"/><stop offset="100%" stopColor="#5ec5ff"/></linearGradient></defs><circle cx={size/2} cy={size/2} r={r} stroke="rgba(130,130,150,.22)" strokeWidth={stroke} fill="none"/><circle cx={size/2} cy={size/2} r={r} stroke="url(#rg)" strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{transition:'stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)'}}/></svg><div className="absolute text-center"><div className="display text-3xl">{label}</div><div className="text-[10px] uppercase tracking-[.2em] text-mute">{sub}</div></div></div>); }
function Chip({children, tone='line'}){ const map={ line:'border-white/12 text-mute bg-white/[.02]', brand:'border-indigo/40 text-indigo bg-indigo/10', good:'border-good/40 text-good bg-good/10', gold:'border-gold/40 goldtext bg-gold/10', warn:'border-warn/40 text-warn bg-warn/10', bad:'border-bad/40 text-bad bg-bad/10' }; return <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${map[tone]}`}>{children}</span>; }
function Kicker({children}){ return <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[.32em] text-mute"><span className="h-px w-8 bg-gradient-to-r from-violet to-transparent"/>{children}</div>; }
function fmtTime(t){ return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0'); }

/* ============================== NAV ============================== */
function Nav({route, setRoute, state, theme, setTheme, onLogout}){
  const tabs=[['home','Home'],['challenge','Challenge'],['charts','Charts Lab'],['exam','Exam'],['dashboard','Dashboard']];
  const [scrolled,setScrolled]=useState(false);
  useEffect(()=>{ const f=()=>setScrolled(window.scrollY>10); window.addEventListener('scroll',f); return ()=>window.removeEventListener('scroll',f); },[]);
  const pmp=useCountUp(state.pmp);
  return (
    <div className={`sticky top-0 z-40 transition-all duration-300 ${scrolled?'bg-ink/80 backdrop-blur-xl border-b border-line':'border-b border-transparent'}`}>
      <div className="max-w-6xl mx-auto px-6 h-[72px] flex items-center gap-5">
        <button onClick={()=>setRoute('home')} className="flex items-center gap-2.5"><span className="grid place-items-center w-9 h-9 rounded-xl btn-primary text-base">◆</span><span className="font-semibold text-[17px] tracking-tight">PM <span className="gradtext">Sim Lab</span></span></button>
        <nav className="hidden md:flex items-center gap-1 ml-2 p-1 rounded-full border border-line bg-white/[.02]">{tabs.map(([k,l])=>(<button key={k} onClick={()=>setRoute(k)} className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-all ${route===k?'bg-white/10 text-white shadow-sm':'text-mute hover:text-white'}`}>{l}</button>))}</nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <button onClick={()=>setTheme(theme==='light'?'dark':'light')} title="Toggle theme" aria-label={theme==='light'?'Switch to dark mode':'Switch to light mode'} className="grid place-items-center w-9 h-9 rounded-full border border-line bg-white/[.02] hover:bg-white/[.06] transition text-[15px]"><span aria-hidden="true">{theme==='light'?'🌙':'☀️'}</span></button>
          {state.auth ? (<>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-warn text-[13px]">🔥 {state.streak}</span>
            <span className="inline-flex items-baseline gap-1.5 font-semibold text-[14px]"><span className="gradtext">{pmp.toLocaleString()}</span><span className="text-mute2 font-normal text-[11px]">XP</span></span>
            <span className="hidden md:inline-flex px-3 py-1.5 rounded-full border border-line bg-white/[.02] text-[12px]">{state.premium?'★ Senior PM':'Junior PM'} · Lv{state.level}</span>
            <div className="flex items-center gap-2">
              <span title={state.auth.email} className="grid place-items-center w-9 h-9 rounded-full btn-primary text-[13px] font-semibold">{(state.auth.name||'U').slice(0,1).toUpperCase()}</span>
              <button onClick={onLogout} title="Sign out" className="hidden sm:inline-flex text-mute hover:text-white text-[12px]">Sign out</button>
            </div>
          </>) : (
            <button onClick={()=>setRoute('login')} className="btn-primary px-4 py-2 rounded-full text-[13px]">Sign in</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== HOME ============================== */
const HOW_IT_WORKS=[
  ['①','Face a real scenario',`A messy, realistic PM situation with shuffled options and distractor detail — you make the call under a timer.`],
  ['②','Get instant AI coaching',`Coach Mira breaks down the outcome, the why, and the better move — the moment you answer.`],
  ['③','Earn your certificate',`Clear the free track, pass the timed exam, and get a shareable credential with a verifiable ID.`],
];
function CountUp({target, suffix=''}){ const v=useCountUp(target,1100); return <>{v}{suffix}</>; }
function StatNum({stat}){
  const [seen,setSeen]=useState(false); const ref=useRef(null);
  useEffect(()=>{ const el=ref.current; if(!el)return; const io=new IntersectionObserver(es=>{ if(es[0].isIntersecting){ setSeen(true); io.disconnect(); } },{threshold:.4}); io.observe(el); return ()=>io.disconnect(); },[]);
  return (<div ref={ref}><div className="display text-3xl gradtext">{stat.static!=null ? stat.static : (seen ? <CountUp target={stat.num} suffix={stat.suffix||''}/> : '0'+(stat.suffix||''))}</div><div className="text-[12px] uppercase tracking-[.18em] text-mute mt-1">{stat.sub}</div></div>);
}
function TeamCTA(){
  const [email,setEmail]=useState(''),[seats,setSeats]=useState('5–25 PMs'),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[err,setErr]=useState('');
  const submit=async()=>{
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ setErr('Enter a valid work email.'); return; }
    setErr(''); setBusy(true);
    try{
      const res=await fetch('/api/team-lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,seats})});
      if(res.ok) setSent(true); else { const d=await res.json().catch(()=>({})); setErr(d.error||'Could not submit — please try again.'); }
    }catch(e){ setErr('Could not submit — please try again.'); }
    setBusy(false);
  };
  return (<section className="py-16 border-t border-line"><div className="card ring-soft p-8 md:p-10 grid md:grid-cols-[1.1fr,.9fr] gap-8 items-center">
    <div>
      <Chip tone="brand">◈ For teams &amp; PMOs</Chip>
      <h2 className="display text-[clamp(1.8rem,3vw,2.6rem)] mt-4 leading-tight">Train your whole PMO to make better calls.</h2>
      <p className="text-mute text-[15px] mt-3 leading-relaxed">Seats for your team, a manager dashboard of skill-tree mastery, and a shared standard for how your PMs make decisions. Tell us your team size and we'll set you up.</p>
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-slate-200">{['Per-seat team plans','Manager analytics','Shared leaderboard','Verifiable credentials'].map(x=>(<span key={x} className="flex items-center gap-2"><span className="text-good">✓</span>{x}</span>))}</div>
    </div>
    <div className="card p-6">
      {sent ? (<div className="text-center py-6"><div className="w-12 h-12 mx-auto rounded-full btn-primary grid place-items-center text-xl">✓</div><div className="font-semibold mt-3 text-[15px]">Thanks — we'll be in touch.</div><p className="text-mute text-[13px] mt-1">We'll reach out about team access shortly.</p></div>) : (<>
        <label className="block text-[12px] text-mute mb-1.5">Work email</label>
        <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="you@company.com" className="w-full px-4 py-3 rounded-xl bg-white/[.03] border border-line text-[14px] focus:border-indigo outline-none transition"/>
        <label className="block text-[12px] text-mute mb-1.5 mt-3">Team size</label>
        <select value={seats} onChange={e=>setSeats(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-ink border border-line text-[14px] focus:border-indigo outline-none transition">{['1–4 PMs','5–25 PMs','25–100 PMs','100+ PMs'].map(s=>(<option key={s}>{s}</option>))}</select>
        {err && <p className="text-bad text-[12.5px] mt-3">{err}</p>}
        <button onClick={submit} disabled={busy} className="btn-primary w-full mt-4 py-3 rounded-xl text-[14px] disabled:opacity-60">{busy?'Sending…':'Request team access →'}</button>
        <p className="text-center text-[11px] text-mute2 mt-3">No commitment — we'll share plans &amp; pricing.</p>
      </>)}
    </div>
  </div></section>);
}
function Home({setRoute}){
  return (
    <div className="max-w-6xl mx-auto px-6">
      <section className="grid lg:grid-cols-[1.05fr,.95fr] gap-14 items-center pt-20 pb-16">
        <div>
          <div className="animate-rise" style={{animationDelay:'0s'}}><Chip tone="gold">◆ 25 scenarios · 5 chart builders · 1 certification</Chip></div>
          <h1 className="display mt-6 text-[clamp(2.6rem,5.4vw,4.4rem)] leading-[1.02] font-medium animate-rise" style={{animationDelay:'.08s'}}>Master project management by <span className="gradtext italic">doing</span>, not watching.</h1>
          <p className="mt-6 text-[17px] leading-relaxed text-mute max-w-xl animate-rise" style={{animationDelay:'.18s'}}>{SCENARIOS.length} realistic crisis scenarios, five hands-on chart builders with project briefs, and a timed certification exam. 60–90 minutes of decisions that mirror the real job — with AI coaching in seconds.</p>
          <div className="mt-9 flex flex-wrap gap-3.5 animate-rise" style={{animationDelay:'.28s'}}><button onClick={()=>setRoute('challenge')} className="btn-primary px-7 py-3.5 rounded-2xl text-[15px]">Start free diagnostic →</button><button onClick={()=>setRoute('charts')} className="btn-ghost px-7 py-3.5 rounded-2xl text-[15px] font-medium">Open the Charts Lab</button></div>
          <div className="mt-8 flex items-center gap-6 text-[13px] text-mute animate-rise" style={{animationDelay:'.36s'}}><span className="flex items-center gap-2"><span className="text-good">✓</span> Free to start — no card required</span><span className="h-4 w-px bg-line"/><span>Free through Junior PM · <span className="text-white font-medium">$49</span> to certify</span></div>
        </div>
        <div className="relative animate-rise" style={{animationDelay:'.1s'}}>
          <div className="absolute -inset-6 bg-gradient-to-tr from-indigo/20 via-transparent to-sky/20 blur-2xl rounded-full"/>
          <div className="relative card ring-soft p-6 animate-floaty">
            <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[11px] uppercase tracking-[.2em] text-mute"><span className="w-2 h-2 rounded-full bg-bad animate-glow"/> Live scenario</span><Chip tone="brand">◈ Budget · Lv4</Chip></div>
            <p className="mt-5 display text-[21px] leading-snug">"40% in: PV $220k, EV $180k, AC $230k. Sponsor asks — are we fine?"</p>
            <div className="mt-5 space-y-2.5">{[['A',`Yes, we've spent about what we planned`,false],['B',`No — SPI 0.82, CPI 0.78, ~$640k at completion`,true],['C',`Ahead of schedule, slightly over`,false]].map(([k,o,c])=>(<div key={k} className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-[14px] transition ${c?'border-sky/50 bg-sky/[.07] text-white':'border-line text-mute'}`}><span className={`grid place-items-center w-6 h-6 rounded-md text-[11px] ${c?'bg-sky/20 text-sky':'bg-white/5'}`}>{k}</span>{o}{c&&<span className="ml-auto text-sky">✓</span>}</div>))}</div>
            <button onClick={()=>setRoute('challenge')} className="btn-primary mt-5 w-full py-3 rounded-xl text-[14px]">Make the call →</button>
          </div>
        </div>
      </section>

      <section className="py-8 border-y border-line"><div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">{[{num:SCENARIOS.length,sub:'crisis scenarios'},{num:5,sub:'chart builders'},{static:'60–90 min',sub:'of gameplay'},{static:'70%',sub:'to certify'}].map((s,i)=>(<StatNum key={i} stat={s}/>))}</div></section>

      <section className="py-20"><Kicker>Why PM Sim Lab is different</Kicker><h2 className="display text-[clamp(2rem,3.6vw,3rem)] mt-4 max-w-2xl leading-tight">Not another video course. You make decisions and build the artifacts.</h2>
        <div className="mt-12 grid md:grid-cols-3 gap-5">{[['◆','Real situations, not trivia',`${SCENARIOS.length} scenarios modelled on the messes PMs actually face — with shuffled answers and distractor detail, just like the real exam.`],['▦','Hands-on Charts Lab','Five interactive builders, each with a realistic project brief: build a Gantt, recover a project via EVM, clean up a RACI, finish a burndown. Earn XP for hitting each target.'],['✦','Adaptive AI coach + certification','Ask the AI when you\'re stuck, get instant Outcome → Why → Better-move feedback, then a timed exam that issues a shareable certificate.']].map((c,i)=>(<div key={i} className="card card-hover p-6"><div className="text-2xl gradtext">{c[0]}</div><div className="mt-3 text-[17px] font-semibold">{c[1]}</div><div className="text-[14px] text-mute mt-2 leading-relaxed">{c[2]}</div></div>))}</div>
      </section>

      <section className="py-16 border-t border-line"><div className="flex items-end justify-between flex-wrap gap-4"><div><Kicker>The Charts Lab</Kicker><h2 className="display text-[clamp(2rem,3.6vw,3rem)] mt-4 leading-tight">The five charts every<br/>PM must build.</h2></div><button onClick={()=>setRoute('charts')} className="btn-ghost px-6 py-3 rounded-2xl text-[14px] font-medium">Try the builders →</button></div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-5 gap-4">{[['Gantt + critical path','▦'],['Risk heatmap','⚠︎'],['EVM / S-curve','◈'],['Burndown','⟳'],['RACI matrix','◎']].map((c,i)=>(<div key={i} className="card card-hover p-5"><div className="text-2xl gradtext">{c[1]}</div><div className="mt-4 font-semibold text-[15px]">{c[0]}</div><div className="text-[12.5px] text-mute mt-1">Brief + build challenge</div></div>))}</div>
      </section>

      <section className="py-16 border-t border-line"><Kicker>How it works</Kicker><h2 className="display text-[clamp(2rem,3.6vw,3rem)] mt-4 mb-10 leading-tight">Make the call. Get coached. Get certified.</h2>
        <div className="grid md:grid-cols-3 gap-5">{HOW_IT_WORKS.map((c,i)=>(<div key={i} className="card card-hover p-6"><div className="text-2xl gradtext">{c[0]}</div><div className="mt-3 text-[17px] font-semibold">{c[1]}</div><div className="text-[14px] text-mute mt-2 leading-relaxed">{c[2]}</div></div>))}</div>
      </section>

      <section className="py-16 border-t border-line"><div className="grid lg:grid-cols-[1fr,.8fr] gap-6 items-stretch">
        <div className="card p-8"><Kicker>What you get for $49</Kicker><h2 className="display text-3xl mt-4">A full certification path — one price, lifetime access.</h2>
          <div className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-3 text-[14px]">{[`${SCENARIOS.length} adaptive crisis scenarios`,'Five chart builders + project briefs','Ask-the-AI help on any question','Timed certification exam','Shareable certificate + LinkedIn badge','Light & dark themes','Adaptive difficulty engine','Referral rewards for your team'].map(x=>(<div key={x} className="flex items-center gap-2.5 text-slate-200"><span className="text-good">✓</span>{x}</div>))}</div></div>
        <div className="card ring-soft p-8 flex flex-col justify-center text-center relative overflow-hidden"><div className="absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-48 bg-gold/15 blur-3xl"/><div className="relative"><Chip tone="gold">◆ Best value in PM training</Chip><div className="display text-6xl goldtext mt-5">$49</div><div className="text-mute text-[13px] mt-1">one-time · vs $200+/yr for video courses</div><button onClick={()=>setRoute('challenge')} className="btn-gold mt-6 w-full py-3.5 rounded-2xl">Start free, certify for $49 →</button><p className="mt-3 text-[12px] text-mute2">Refer a colleague — you both earn rewards.</p></div></div>
      </div></section>

      <TeamCTA/>

      <section className="py-20"><div className="card ring-soft relative overflow-hidden p-12 text-center"><div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gradient-to-b from-indigo/25 to-transparent blur-3xl"/><div className="relative"><h2 className="display text-[clamp(2.2rem,4vw,3.4rem)] leading-tight max-w-2xl mx-auto">Ready to make the calls that matter?</h2><p className="mt-4 text-mute text-[16px]">Start free. Certify for a one-time <span className="text-white font-medium">$49</span> — lifetime access, no subscription.</p><button onClick={()=>setRoute('challenge')} className="btn-primary mt-8 px-9 py-4 rounded-2xl text-[15px]">Begin your first scenario →</button></div></div></section>
    </div>
  );
}

/* ============================== CHART BUILDERS ============================== */
function svgLine(points){ return points.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' '); }
function Brief({code, children}){ return (<div className="mb-4 rounded-2xl border border-indigo/30 bg-indigo/[.07] p-4"><div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-indigo">📋 Project brief · {code}</div><div className="mt-1.5 text-[13.5px] text-slate-200 leading-relaxed">{children}</div></div>); }
function Mission({done, target, reward}){ return (<div className={`mb-5 rounded-2xl border p-4 ${done?'border-good/40 bg-good/[.06]':'border-gold/30 bg-gold/[.05]'}`}><div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider"><span>{done?'✓':'🎯'}</span><span className={done?'text-good':'goldtext'}>Build challenge {done?'complete':'· +'+reward+' XP'}</span></div><p className="mt-1.5 text-[13.5px] text-slate-200">{target}</p></div>); }

function GanttBuilder({done, onWin}){
  const [tasks,setTasks]=useState([{id:1,name:'Discovery & scope',start:0,dur:5,dep:null},{id:2,name:'UX / design',start:5,dur:6,dep:1},{id:3,name:'Front-end build',start:11,dur:8,dep:2},{id:4,name:'Content (parallel)',start:5,dur:6,dep:1},{id:5,name:'QA & launch',start:19,dur:4,dep:3}]);
  const sched=useMemo(()=>{ const byId={}; tasks.forEach(t=>byId[t.id]=t); const eft={}; const memo=t=>{ if(eft[t.id]!=null)return eft[t.id]; const base=t.dep&&byId[t.dep]?Math.max(t.start,memo(byId[t.dep])):t.start; const e=base+t.dur; eft[t.id]=e; return e; }; tasks.forEach(memo); const end=Math.max(0,...tasks.map(t=>eft[t.id])); const crit=new Set(); tasks.filter(t=>eft[t.id]===end).forEach(t=>{ let cur=t; while(cur){ crit.add(cur.id); cur=cur.dep?byId[cur.dep]:null; } }); return {end,crit,eft,byId}; },[tasks]);
  const won=done.includes('m_gantt'); useEffect(()=>{ if(!won && sched.end<=18) onWin('m_gantt',120); },[sched.end]);
  const maxDay=Math.max(24,sched.end), W=560, rowH=34, padL=140, colW=(W-padL)/maxDay;
  const add=()=>setTasks(t=>[...t,{id:Date.now(),name:'New task',start:0,dur:3,dep:null}]);
  const upd=(id,k,v)=>setTasks(t=>t.map(x=>x.id===id?{...x,[k]:v}:x)); const del=id=>setTasks(t=>t.filter(x=>x.id!==id));
  return (<div>
    <Brief code="ATLAS — CRM migration"><b className="text-white">Acme is replacing its CRM in 6 weeks.</b> Work packages: Discovery (5d) → Design (6d) → Front-end build (8d) → QA &amp; launch (4d), with Content (6d) running in parallel after Discovery. The sponsor needs go-live by <b className="text-white">day 18</b>. You have one extra developer to crash a single task. Build the schedule and pull the finish in.</Brief>
    <Mission done={won} target="Hit the deadline: shorten durations or re-sequence so the project finishes on or before day 18." reward={120}/>
    <p className="text-[14px] text-mute leading-relaxed">A <b className="text-white">Gantt chart</b> exposes the <b className="text-white">critical path</b> — the longest dependent chain that sets the finish date. Crashing a task off it won't pull your date in.</p>
    <div className="mt-5 card p-4 overflow-x-auto"><svg width={W} height={tasks.length*rowH+28} className="min-w-[560px]">
      {Array.from({length:maxDay+1}).map((_,d)=> d%4===0 && (<g key={d}><line x1={padL+d*colW} y1="18" x2={padL+d*colW} y2={tasks.length*rowH+18} stroke="rgba(130,130,150,.18)"/><text x={padL+d*colW} y="12" fill="#8b93a8" fontSize="9" textAnchor="middle">d{d}</text></g>))}
      <line x1={padL+sched.end*colW} y1="14" x2={padL+sched.end*colW} y2={tasks.length*rowH+18} stroke="#fb7185" strokeDasharray="3 3" opacity=".7"/>
      {tasks.map((t,i)=>{ const y=18+i*rowH, fin=sched.eft[t.id], st=fin-t.dur, isC=sched.crit.has(t.id); return (<g key={t.id}><text x="0" y={y+rowH/2+3} fill="currentColor" fontSize="11" className="text-slate-300">{t.name.slice(0,18)}</text><rect x={padL+st*colW} y={y+6} width={Math.max(2,t.dur*colW)} height={rowH-14} rx="5" fill={isC?'url(#gC)':'url(#gN)'} stroke={isC?'#fb7185':'rgba(130,130,150,.3)'}/><text x={padL+st*colW+6} y={y+rowH/2+3} fill="#06080f" fontSize="10" fontWeight="600">{t.dur}d</text></g>); })}
      <defs><linearGradient id="gN" x1="0" x2="1"><stop offset="0" stopColor="#8b7cf0"/><stop offset="1" stopColor="#5ec5ff"/></linearGradient><linearGradient id="gC" x1="0" x2="1"><stop offset="0" stopColor="#fb7185"/><stop offset="1" stopColor="#fbbf24"/></linearGradient></defs>
    </svg></div>
    <div className="mt-3 flex items-center gap-3 text-[12px] text-mute"><span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gradient-to-r from-bad to-warn"/> Critical path</span><span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gradient-to-r from-violet to-sky"/> Has float</span><span className="ml-auto">Project finishes: <b className={sched.end<=18?'text-good':'text-white'}>day {sched.end}</b></span></div>
    <div className="mt-4 space-y-2">{tasks.map(t=>(<div key={t.id} className="flex flex-wrap items-center gap-2 text-[12px] bg-white/[.02] border border-line rounded-xl p-2.5"><input value={t.name} onChange={e=>upd(t.id,'name',e.target.value)} className="bg-transparent border border-line rounded-lg px-2 py-1 w-36 outline-none focus:border-indigo"/><label className="flex items-center gap-1 text-mute">start<input type="range" min="0" max="20" value={t.start} onChange={e=>upd(t.id,'start',+e.target.value)} className="w-20"/><span className="w-5 text-white">{t.start}</span></label><label className="flex items-center gap-1 text-mute">dur<input type="range" min="1" max="12" value={t.dur} onChange={e=>upd(t.id,'dur',+e.target.value)} className="w-20"/><span className="w-5 text-white">{t.dur}</span></label><select value={t.dep||''} onChange={e=>upd(t.id,'dep',e.target.value?+e.target.value:null)} className="bg-ink border border-line rounded-lg px-2 py-1 text-mute outline-none focus:border-indigo"><option value="">no dependency</option>{tasks.filter(x=>x.id!==t.id).map(x=>(<option key={x.id} value={x.id}>after: {x.name.slice(0,14)}</option>))}</select><button onClick={()=>del(t.id)} className="ml-auto text-mute2 hover:text-bad px-1">✕</button></div>))}</div>
    <button onClick={add} className="btn-ghost mt-3 px-4 py-2 rounded-xl text-[13px]">+ Add task</button>
  </div>);
}

function RiskBuilder({done, onWin}){
  const [risks,setRisks]=useState([{id:1,name:'Cloud region outage',p:2,i:5},{id:2,name:'Vendor price hike',p:1,i:4},{id:3,name:'Tester on holiday',p:4,i:2},{id:4,name:'Copy rework',p:3,i:1}]);
  const [name,setName]=useState(''),[p,setP]=useState(3),[i,setI]=useState(3);
  const cell=(pp,ii)=>{ const s=pp*ii; return s>=15?'#fb7185':s>=8?'#fbbf24':'#4ade80'; };
  const sorted=[...risks].sort((a,b)=>b.p*b.i-a.p*a.i); const won=done.includes('m_risk'); const topExp=sorted[0]?sorted[0].p*sorted[0].i:0;
  useEffect(()=>{ if(!won && topExp>=15) onWin('m_risk',100); },[topExp]);
  const add=()=>{ if(!name)return; setRisks(r=>[...r,{id:Date.now(),name,p,i}]); setName(''); }; const S=58, gap=4;
  return (<div>
    <Brief code="HELIOS — fintech launch"><b className="text-white">A payments app launches in 8 weeks on a single cloud region with a brand-new vendor.</b> Build the risk register: capture the threats, score each by probability and impact, and make sure your highest-exposure threat is correctly flagged for a response plan.</Brief>
    <Mission done={won} target="Triage the register: add or adjust risks so your #1 ranked threat lands in the red zone (exposure ≥ 15)." reward={100}/>
    <p className="text-[14px] text-mute leading-relaxed">A <b className="text-white">risk heatmap</b> ranks threats by <b className="text-white">probability × impact (exposure)</b>. The hottest cells demand a response plan now.</p>
    <div className="mt-5 grid sm:grid-cols-[auto,1fr] gap-6">
      <div className="card p-4 w-fit"><div className="grid" style={{gridTemplateColumns:`repeat(5,${S}px)`,gap}}>{[5,4,3,2,1].map(ii=>[1,2,3,4,5].map(pp=>{ const here=risks.filter(r=>r.p===pp&&r.i===ii); return <div key={pp+'-'+ii} className="rounded-md relative" style={{width:S,height:S,background:cell(pp,ii)+'22',border:`1px solid ${cell(pp,ii)}55`}}>{here.map((r,k)=>(<span key={r.id} title={r.name} className="absolute w-4 h-4 rounded-full" style={{background:cell(pp,ii),top:6+k*5,left:6+k*5,boxShadow:'0 0 0 2px currentColor'}}/>))}</div>; }))}</div><div className="text-[10px] text-mute2 mt-2 text-center">Probability → · Impact ↑</div></div>
      <div><div className="text-[11px] uppercase tracking-[.2em] text-mute mb-3">Exposure ranking</div><div className="space-y-2">{sorted.map(r=>{ const s=r.p*r.i; return (<div key={r.id} className="flex items-center gap-3 text-[13px] bg-white/[.02] border border-line rounded-lg px-3 py-2"><span className="w-2.5 h-2.5 rounded-full" style={{background:cell(r.p,r.i)}}/><span className="flex-1">{r.name}</span><span className="text-mute">P{r.p}·I{r.i}</span><span className="font-semibold tabular-nums" style={{color:cell(r.p,r.i)}}>{s}</span><button onClick={()=>setRisks(x=>x.filter(y=>y.id!==r.id))} className="text-mute2 hover:text-bad">✕</button></div>); })}</div></div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]"><input value={name} onChange={e=>setName(e.target.value)} placeholder="New risk…" className="bg-white/[.03] border border-line rounded-lg px-3 py-2 outline-none focus:border-indigo w-44"/><label className="flex items-center gap-1 text-mute">prob<input type="range" min="1" max="5" value={p} onChange={e=>setP(+e.target.value)} className="w-20"/><span className="text-white w-4">{p}</span></label><label className="flex items-center gap-1 text-mute">impact<input type="range" min="1" max="5" value={i} onChange={e=>setI(+e.target.value)} className="w-20"/><span className="text-white w-4">{i}</span></label><button onClick={add} className="btn-ghost px-4 py-2 rounded-xl">+ Add risk</button></div>
  </div>);
}

function EVMBuilder({done, onWin}){
  const [bac,setBac]=useState(500),[plan,setPlan]=useState(44),[ev,setEv]=useState(36),[ac,setAc]=useState(230);
  const PV=bac*plan/100, EV=bac*ev/100, AC=ac, CPI=AC?EV/AC:0, SPI=PV?EV/PV:0, EAC=CPI?bac/CPI:0, VAC=bac-EAC;
  const won=done.includes('m_evm'); useEffect(()=>{ if(!won && CPI>=1 && SPI>=1) onWin('m_evm',140); },[CPI,SPI]);
  const W=540,H=200,pl=44,pb=24, x=t=>pl+t*(W-pl-10), y=v=>H-pb-(v/Math.max(bac,EAC))*(H-pb-12);
  const pvPts=[[pl,y(0)],[x(1),y(bac)]]; const now=ev/100; const evPts=[[x(0),y(0)],[x(now),y(EV)]]; const acPts=[[x(0),y(0)],[x(now),y(AC)]];
  const stat=(label,val,good)=>(<div className="bg-white/[.02] border border-line rounded-xl p-3"><div className="text-[10px] uppercase tracking-wider text-mute">{label}</div><div className={`text-[17px] font-semibold mt-0.5 ${good===null?'':good?'text-good':'text-bad'}`}>{val}</div></div>);
  return (<div>
    <Brief code="ORION — platform build"><b className="text-white">A $500k, 20-week platform is at the mid-point.</b> The board wants a status read. Current data: 44% of the plan should be done (PV), only 36% is actually earned (EV), and $230k has been spent (AC). Diagnose the health — then model a recovery that brings both CPI and SPI back to 1.0.</Brief>
    <Mission done={won} target="Recover the project: adjust the inputs until both CPI ≥ 1.0 (on budget) and SPI ≥ 1.0 (on schedule)." reward={140}/>
    <p className="text-[14px] text-mute leading-relaxed"><b className="text-white">EVM</b> turns "feels behind" into numbers. <b className="text-white">CPI = EV/AC</b>, <b className="text-white">SPI = EV/PV</b>. Under 1.0 is trouble. <b className="text-white">EAC = BAC/CPI</b> forecasts the true final cost.</p>
    <div className="mt-5 card p-4"><svg width={W} height={H} className="w-full"><line x1={pl} y1={H-pb} x2={W-10} y2={H-pb} stroke="rgba(130,130,150,.25)"/><line x1={pl} y1="12" x2={pl} y2={H-pb} stroke="rgba(130,130,150,.25)"/><path d={svgLine(pvPts)} stroke="#8b93a8" strokeWidth="2" fill="none" strokeDasharray="5 4"/><path d={svgLine(acPts)} stroke="#fb7185" strokeWidth="2.5" fill="none"/><path d={svgLine(evPts)} stroke="#4ade80" strokeWidth="2.5" fill="none"/><circle cx={x(now)} cy={y(EV)} r="4" fill="#4ade80"/><circle cx={x(now)} cy={y(AC)} r="4" fill="#fb7185"/><text x={W-12} y={y(bac)-4} fill="#8b93a8" fontSize="9" textAnchor="end">PV (plan)</text></svg><div className="flex gap-4 text-[11px] text-mute mt-1"><span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-good"/>EV earned</span><span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-bad"/>AC actual</span><span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-mute"/>PV planned</span></div></div>
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">{stat('SPI',SPI.toFixed(2),SPI>=1)}{stat('CPI',CPI.toFixed(2),CPI>=1)}{stat('EAC','$'+Math.round(EAC)+'k',EAC<=bac)}{stat('VAC','$'+Math.round(VAC)+'k',VAC>=0)}</div>
    <div className={`mt-3 rounded-xl border p-3 text-[13px] ${CPI>=1&&SPI>=1?'border-good/40 bg-good/[.06] text-good':'border-bad/40 bg-bad/[.06] text-bad'}`}>{CPI>=1&&SPI>=1?'On or ahead of cost and schedule — healthy.':`${SPI<1?'Behind schedule':'On schedule'} and ${CPI<1?'over budget':'on budget'}. Forecast final cost ≈ $${Math.round(EAC)}k vs $${bac}k baseline.`}</div>
    <div className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[12px]">{[['Budget (BAC) $k',bac,setBac,100,1000],['Planned % complete',plan,setPlan,0,100],['Earned % complete (EV)',ev,setEv,0,100],['Actual cost (AC) $k',ac,setAc,0,1000]].map(([l,v,set,mn,mx])=>(<label key={l} className="flex items-center gap-2 text-mute"><span className="w-40">{l}</span><input type="range" min={mn} max={mx} value={v} onChange={e=>set(+e.target.value)} className="flex-1"/><span className="text-white w-12 text-right tabular-nums">{v}</span></label>))}</div>
  </div>);
}

function BurndownBuilder({done, onWin}){
  const days=10, total=40; const [actual,setActual]=useState([40,38,33,31,30,26,19,14,8,3]);
  const won=done.includes('m_burn'); useEffect(()=>{ if(!won && actual[days-1]===0) onWin('m_burn',100); },[actual]);
  const W=540,H=200,pl=30,pb=24, x=d=>pl+d*(W-pl-10)/(days-1), y=v=>H-pb-(v/total)*(H-pb-12);
  const ideal=Array.from({length:days},(_,d)=>[x(d),y(total-(total/(days-1))*d)]); const act=actual.map((v,d)=>[x(d),y(v)]);
  const set=(d,v)=>setActual(a=>a.map((x,i)=>i===d?clamp(v,0,total):x));
  return (<div>
    <Brief code="NOVA — 2-week sprint"><b className="text-white">Your team committed to 40 story points across a 10-day sprint.</b> Track the remaining work each day against the ideal pace and steer the team to land the sprint at zero by day 10.</Brief>
    <Mission done={won} target="Finish the sprint: drag day 10's remaining work down to 0 so the burndown reaches the baseline." reward={100}/>
    <p className="text-[14px] text-mute leading-relaxed">A <b className="text-white">burndown chart</b> tracks remaining work against the ideal pace. <b className="text-white">Above</b> the line = behind; <b className="text-white">below</b> = ahead.</p>
    <div className="mt-5 card p-4"><svg width={W} height={H} className="w-full"><line x1={pl} y1={H-pb} x2={W-10} y2={H-pb} stroke="rgba(130,130,150,.25)"/><line x1={pl} y1="12" x2={pl} y2={H-pb} stroke="rgba(130,130,150,.25)"/><path d={svgLine(ideal)} stroke="#8b93a8" strokeWidth="2" strokeDasharray="5 4" fill="none"/><path d={svgLine(act)} stroke="url(#bd)" strokeWidth="2.5" fill="none"/>{act.map((p,d)=>(<circle key={d} cx={p[0]} cy={p[1]} r="3.5" fill="#5ec5ff"/>))}<defs><linearGradient id="bd" x1="0" x2="1"><stop offset="0" stopColor="#8b7cf0"/><stop offset="1" stopColor="#5ec5ff"/></linearGradient></defs>{Array.from({length:days}).map((_,d)=>(<text key={d} x={x(d)} y={H-8} fill="#8b93a8" fontSize="9" textAnchor="middle">{d+1}</text>))}</svg></div>
    <div className="mt-3 grid grid-cols-5 sm:grid-cols-10 gap-1.5">{actual.map((v,d)=>(<label key={d} className="flex flex-col items-center gap-1 text-[10px] text-mute2"><input type="range" min="0" max={total} value={v} onChange={e=>set(d,+e.target.value)} className="w-full" style={{writingMode:'vertical-lr',direction:'rtl',height:54}}/>d{d+1}</label>))}</div>
  </div>);
}

function RaciBuilder({done, onWin}){
  const roles=['Sponsor','PM','Dev Lead','QA','Client'];
  const [rows,setRows]=useState([{id:1,name:'Approve budget',cells:['A','C','I','I','C']},{id:2,name:'Define requirements',cells:['C','A','C','I','R']},{id:3,name:'Build feature',cells:['I','A','R','C','I']},{id:4,name:'Sign off release',cells:['A','A','C','C','I']}]);
  const cycle={'':'R','R':'A','A':'C','C':'I','I':''}; const col={'R':'#5ec5ff','A':'#4ade80','C':'#fbbf24','I':'#8b93a8','':'transparent'};
  const click=(ri,ci)=>setRows(rs=>rs.map((r,i)=>i!==ri?r:{...r,cells:r.cells.map((c,j)=>j===ci?cycle[c]:c)}));
  const issues=rows.filter(r=>r.cells.filter(c=>c==='A').length!==1); const won=done.includes('m_raci');
  useEffect(()=>{ if(!won && issues.length===0) onWin('m_raci',100); },[issues.length]);
  return (<div>
    <Brief code="VEGA — vendor integration"><b className="text-white">You're setting governance for a vendor integration.</b> Roles: Sponsor, PM, Dev Lead, QA, Client. The draft matrix has a problem — "Sign off release" currently lists two Accountable owners, which breaks accountability. Repair it so every activity has exactly one A.</Brief>
    <Mission done={won} target="Fix the matrix: click cells to cycle roles until every activity has exactly one Accountable owner." reward={100}/>
    <p className="text-[14px] text-mute leading-relaxed">A <b className="text-white">RACI matrix</b> assigns who is <b className="text-sky">R</b>esponsible, <b className="text-good">A</b>ccountable, <b className="text-warn">C</b>onsulted and <b className="text-mute">I</b>nformed. Golden rule: <b className="text-white">exactly one Accountable per row</b>.</p>
    <div className="mt-5 card p-4 overflow-x-auto"><table className="text-[12px] w-full min-w-[460px]"><thead><tr><th className="text-left text-mute font-medium pb-2">Activity</th>{roles.map(r=>(<th key={r} className="text-mute font-medium pb-2 px-1">{r}</th>))}</tr></thead><tbody>{rows.map((row,ri)=>(<tr key={row.id} className="border-t border-line"><td className="py-2 pr-3 text-slate-200">{row.name}</td>{row.cells.map((c,ci)=>(<td key={ci} className="text-center py-2 px-1"><button onClick={()=>click(ri,ci)} className="w-8 h-8 rounded-lg font-semibold transition" style={{color:c?'#06080f':'#8b93a8',background:c?col[c]:'rgba(130,130,150,.12)',border:'1px solid '+(c?col[c]:'rgba(130,130,150,.2)')}}>{c||'·'}</button></td>))}</tr>))}</tbody></table></div>
    <div className="mt-3 flex items-center gap-3 text-[12px]"><span className="text-mute">Legend:</span>{[['R','#5ec5ff'],['A','#4ade80'],['C','#fbbf24'],['I','#8b93a8']].map(([l,c])=>(<span key={l} className="w-5 h-5 rounded grid place-items-center text-[10px] font-bold" style={{background:c,color:'#06080f'}}>{l}</span>))}</div>
    {issues.length>0?<div className="mt-3 rounded-xl border border-warn/40 bg-warn/[.07] p-3 text-[13px] text-warn">⚠ {issues.length} activit{issues.length>1?'ies':'y'} need{issues.length>1?'':'s'} exactly one Accountable: {issues.map(i=>i.name).join(', ')}.</div>:<div className="mt-3 rounded-xl border border-good/40 bg-good/[.07] p-3 text-[13px] text-good">✓ Every activity has exactly one Accountable owner. Clean RACI.</div>}
  </div>);
}

const CHART_TABS=[{key:'gantt',label:'Gantt + Critical Path',icon:'▦',C:GanttBuilder},{key:'risk',label:'Risk Heatmap',icon:'⚠︎',C:RiskBuilder},{key:'evm',label:'EVM / S-curve',icon:'◈',C:EVMBuilder},{key:'burndown',label:'Burndown',icon:'⟳',C:BurndownBuilder},{key:'raci',label:'RACI Matrix',icon:'◎',C:RaciBuilder}];
function ChartsLab({initial='gantt', state, dispatch}){
  const [tab,setTab]=useState(initial); useEffect(()=>setTab(initial),[initial]);
  const Active=(CHART_TABS.find(t=>t.key===tab)||CHART_TABS[0]).C; const onWin=(key,reward)=>dispatch({type:'mission',key,reward}); const completed=state.missions.length;
  return (<div className="max-w-6xl mx-auto px-6 py-10">
    <div className="flex items-end justify-between flex-wrap gap-3"><div><Kicker>Charts Lab</Kicker><h1 className="display text-[clamp(2rem,3.6vw,2.8rem)] mt-3">Build the charts PMs live in.</h1></div><Chip tone={completed>=5?'good':'gold'}>{completed} / 5 challenges complete</Chip></div>
    <p className="text-mute text-[15px] mt-2 max-w-2xl">Each builder opens with a real project brief and a build challenge worth XP. Construct the chart from the details — change the inputs and it recomputes live.</p>
    <div className="mt-7 flex flex-wrap gap-2">{CHART_TABS.map(t=>{ const m='m_'+(t.key==='burndown'?'burn':t.key); const ok=state.missions.includes(m); return (<button key={t.key} onClick={()=>setTab(t.key)} className={`px-4 py-2.5 rounded-xl text-[13.5px] font-medium border transition ${tab===t.key?'border-indigo/60 bg-indigo/15 text-white':'border-line text-mute hover:text-white hover:border-line2'}`}><span className="gradtext mr-1.5">{t.icon}</span>{t.label}{ok&&<span className="text-good ml-1.5">✓</span>}</button>); })}</div>
    <div className="mt-6 card ring-soft p-6 md:p-8 animate-rise"><Active done={state.missions} onWin={onWin}/></div>
  </div>);
}

/* ============================== LOGIN ============================== */
function Login({onLogin, setRoute}){
  const inp="w-full px-4 py-3 rounded-xl bg-white/[.03] border border-line text-[14px] focus:border-indigo outline-none transition";
  const [mode,setMode]=useState('signin');
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[pw,setPw]=useState(''),[show,setShow]=useState(false),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const cap=s=> s? s.charAt(0).toUpperCase()+s.slice(1) : s;
  const submit=async()=>{
    if(mode==='signup'&&!name.trim()){ setErr('Please enter your name.'); return; }
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ setErr('Please enter a valid email address.'); return; }
    if(pw.length<6){ setErr('Password must be at least 6 characters.'); return; }
    setErr(''); setNotice('');
    const nm=name.trim()||cap(email.split('@')[0]); const em=email.trim();
    setBusy(true);
    try{
      if(mode==='signup'){
        const { data, error }=await signUp(nm, em, pw);
        if(error){ setErr(error.message); return; }
        if(data?.session) onLogin(nm, em);
        else { setMode('signin'); setNotice('Account created. Check your email to confirm, then sign in.'); }
      } else {
        const { data, error }=await signIn(em, pw);
        if(error){ setErr(error.message); return; }
        if(data?.session) onLogin(nm, em);
        else setErr('Could not start a session — confirm your email, then try again.');
      }
    } catch(e){ setErr(e?.message||'Something went wrong.'); }
    finally{ setBusy(false); }
  };
  const provMap={ google:'google', microsoft:'azure', linkedin:'linkedin_oidc' };
  const social=async(p)=>{
    setErr(''); setNotice('');
    if(!isSupabaseConfigured){ setErr('Authentication is not configured yet.'); return; }
    const { error }=await supabase.auth.signInWithOAuth({ provider:provMap[p]||p, options:{ redirectTo: typeof window!=='undefined'?window.location.origin:undefined } });
    if(error) setErr(`${cap(p)} sign-in isn't enabled for this project yet — use email below.`);
  };
  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <button onClick={()=>setRoute('home')} className="text-mute hover:text-white text-[13px] mb-6 inline-flex items-center gap-1.5">◀ Back to home</button>
      <div className="card ring-soft p-8 animate-rise">
        <div className="flex items-center gap-2.5"><span className="grid place-items-center w-9 h-9 rounded-xl btn-primary text-base">◆</span><span className="font-semibold text-[17px]">PM <span className="gradtext">Sim Lab</span></span></div>
        <h1 className="display text-3xl mt-5">{mode==='signin'?'Welcome back':'Create your account'}</h1>
        <p className="text-mute text-[14px] mt-1.5">{mode==='signin'?'Sign in to continue your certification journey.':'Start free — no card required to begin.'}</p>
        <div className="mt-6 grid grid-cols-3 gap-2">{[['google','G'],['microsoft','⊞'],['linkedin','in']].map(([p,sym])=>(<button key={p} onClick={()=>social(p)} className="btn-ghost py-2.5 rounded-xl text-[13px] font-medium flex items-center justify-center gap-1.5"><span className="text-mute">{sym}</span><span className="capitalize">{p}</span></button>))}</div>
        <div className="flex items-center gap-3 my-5 text-[11px] text-mute2"><span className="flex-1 h-px bg-line"/>or with email<span className="flex-1 h-px bg-line"/></div>
        <div className="space-y-3">
          {mode==='signup' && <input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" className={inp}/>}
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" className={inp}/>
          <div className="relative"><input type={show?'text':'password'} value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="Password" className={inp+' pr-16'}/><button onClick={()=>setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-mute hover:text-white">{show?'hide':'show'}</button></div>
        </div>
        {err && <p className="text-bad text-[12.5px] mt-3">{err}</p>}
        {notice && <p className="text-good text-[12.5px] mt-3">{notice}</p>}
        {mode==='signin' && <div className="text-right mt-2"><button className="text-[12px] text-mute hover:text-white">Forgot password?</button></div>}
        <button onClick={submit} disabled={busy} className="btn-primary w-full mt-4 py-3 rounded-xl text-[15px] disabled:opacity-60">{busy?'Please wait…':(mode==='signin'?'Sign in →':'Create account →')}</button>
        <p className="text-center text-[13px] text-mute mt-5">{mode==='signin'?"New to PM Sim Lab? ":"Already have an account? "}<button onClick={()=>{setMode(mode==='signin'?'signup':'signin');setErr('');}} className="text-indigo font-medium hover:underline">{mode==='signin'?'Create an account':'Sign in'}</button></p>
        <p className="text-center text-[11px] text-mute2 mt-4">🔒 Secured by Supabase Auth — passwords are hashed, never stored in plaintext.</p>
      </div>
    </div>
  );
}

/* ============================== PAYMENT PAGE ============================== */
function Payment({state, onPaid, setRoute}){
  const inp="w-full px-4 py-3 rounded-xl bg-white/[.03] border border-line text-[14px] focus:border-indigo outline-none transition";
  const lbl="block text-[12px] text-mute mb-1.5";
  const [busy,setBusy]=useState(false),[done,setDone]=useState(false),[payErr,setPayErr]=useState(''),[soon,setSoon]=useState(false);
  const [email,setEmail]=useState(state.auth?.email||'');
  const pay=async()=>{
    setBusy(true); setPayErr(''); setSoon(false);
    try{
      const token=await getAccessToken();
      const res=await fetch('/api/checkout',{method:'POST',headers:{Authorization:`Bearer ${token||''}`}});
      if(res.status===503){ setSoon(true); setBusy(false); return; }   // Stripe not wired yet (preview)
      const data=await res.json();
      if(data.url){ window.location.href=data.url; return; }            // → Stripe Checkout
      if(data.alreadyOwned){ onPaid(); setDone(true); return; }
      setPayErr(data.error||'Could not start checkout.');
    }catch(e){ setPayErr(e?.message||'Could not reach the payment service.'); }
    setBusy(false);
  };
  if(state.premium && !done){ return (<div className="max-w-md mx-auto px-6 py-20 text-center"><div className="card ring-soft p-10"><div className="w-16 h-16 mx-auto rounded-full btn-primary grid place-items-center text-2xl">✓</div><h1 className="display text-3xl mt-4">You're already premium</h1><p className="text-mute mt-2 text-[14px]">Your certification track is unlocked. Jump back in.</p><button onClick={()=>setRoute('challenge')} className="btn-primary mt-6 px-7 py-3.5 rounded-2xl">Continue training →</button></div></div>); }
  if(done){ return (<div className="max-w-lg mx-auto px-6 py-20 text-center"><div className="card ring-soft p-10 animate-pop"><div className="w-20 h-20 mx-auto rounded-full btn-primary grid place-items-center text-3xl">✓</div><div className="mt-4 flex justify-center"><Chip tone="good">Payment successful</Chip></div><h1 className="display text-4xl mt-4">You're in! 🎉</h1><p className="text-mute mt-3 text-[14px]">Senior PM crises, the capstone, and the certification exam are now unlocked. A receipt has been sent to {email||'your email'}.</p><div className="mt-7 flex gap-3 justify-center flex-wrap"><button onClick={()=>setRoute('challenge')} className="btn-primary px-7 py-3.5 rounded-2xl">Start advanced training →</button><button onClick={()=>setRoute('dashboard')} className="btn-ghost px-7 py-3.5 rounded-2xl">Dashboard</button></div></div></div>); }
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <button onClick={()=>setRoute('dashboard')} className="text-mute hover:text-white text-[13px] mb-5 inline-flex items-center gap-1.5">◀ Back</button>
      <div className="grid lg:grid-cols-[1fr,1.1fr] gap-6">
        <div className="card p-7 h-fit">
          <Kicker>Order summary</Kicker>
          <h2 className="display text-2xl mt-4">PM Sim Lab — Certification Track</h2>
          <p className="text-mute text-[13.5px] mt-1">One-time payment · lifetime access</p>
          <div className="mt-5 space-y-2.5 text-[14px]">{['Stages 4–6 — branching crisis simulations','Continuous capstone project','Five chart builders + project briefs','Timed exam + shareable certificate','Lifetime updates & new scenario packs'].map(x=>(<div key={x} className="flex items-center gap-2.5 text-slate-200"><span className="text-good">✓</span>{x}</div>))}</div>
          <div className="divider my-5"/>
          <div className="space-y-2 text-[14px]"><div className="flex justify-between text-mute"><span>Certification Track</span><span>$49.00</span></div><div className="flex justify-between text-mute"><span>Tax</span><span>$0.00</span></div><div className="flex justify-between font-semibold text-[16px] mt-1"><span>Total due</span><span className="goldtext">$49.00</span></div></div>
          <div className="mt-5 rounded-xl border border-good/30 bg-good/[.06] p-3 text-[12.5px] text-good">✓ Lifetime access · one-time payment, no subscription.</div>
        </div>
        <div className="card ring-soft p-7">
          <div className="flex items-center justify-between"><Kicker>Payment details</Kicker><span className="text-[11px] text-mute flex items-center gap-1.5">🔒 Secured by Stripe</span></div>
          <div className="mt-5 space-y-3">
            <div><label className={lbl}>Email for receipt</label><input value={email} onChange={e=>setEmail(e.target.value)} className={inp} placeholder="you@email.com"/></div>
            <div className="rounded-xl border border-line bg-white/[.02] p-4 flex items-start gap-3"><span className="text-[18px] mt-0.5" aria-hidden="true">🔒</span><p className="text-[13px] text-mute leading-relaxed">You'll enter your card on Stripe's secure checkout. PM Sim Lab never sees or stores your card number. Test mode accepts <span className="text-white font-medium">4242 4242 4242 4242</span>, any future expiry, any CVC.</p></div>
          </div>
          <button onClick={pay} disabled={busy||soon} className="btn-gold w-full mt-5 py-3.5 rounded-xl disabled:opacity-60">{busy?'Redirecting to secure checkout…':soon?'Certification opening soon':'Pay $49.00 →'}</button>
          {payErr && <p className="mt-3 text-center text-bad text-[12.5px]">{payErr}</p>}
          {soon && <p className="mt-3 text-center text-[12.5px] text-mute">You're on the early preview — paid certification opens shortly. Everything in the free track is yours to explore now.</p>}
          <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-mute2"><span>PCI-DSS</span><span>·</span><span>3-D Secure</span><span>·</span><span>256-bit TLS</span></div>
          <p className="mt-2 text-center text-[11px] text-mute2">Card is processed by Stripe — PM Sim Lab never sees your card number.</p>
        </div>
      </div>
    </div>
  );
}

/* ============================== ASK MIRA ============================== */
function AskMira({sc}){
  const [open,setOpen]=useState(false); const [q,setQ]=useState(''); const [log,setLog]=useState([]); const endRef=useRef(null);
  useEffect(()=>{ setLog([]); setOpen(false); },[sc.id]);
  useEffect(()=>{ if(endRef.current) endRef.current.scrollIntoView({behavior:'smooth'}); },[log]);
  const ask=()=>{ const text=q.trim(); if(!text)return; const a=respondToQuestion(text,sc); setLog(l=>[...l,{me:text},{mira:a}]); setQ(''); };
  if(!open) return (<button onClick={()=>setOpen(true)} className="btn-ghost mt-3 w-full text-[13.5px] py-2.5 rounded-xl">💬 Ask {MENTOR} about this question</button>);
  return (<div className="mt-3 rounded-2xl border border-line bg-white/[.02] p-3 animate-rise">
    <div className="flex items-center justify-between mb-2"><span className="text-[12px] font-medium text-mute">💬 Ask {MENTOR}</span><button onClick={()=>setOpen(false)} className="text-mute2 hover:text-white text-[12px]">close</button></div>
    <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
      {log.length===0 && <p className="text-[12.5px] text-mute2">Confused by a term or the setup? Ask anything — e.g. "what is CPI?" or "what's the critical path here?" I'll explain without spoiling the answer.</p>}
      {log.map((m,i)=> m.me ? <div key={i} className="text-[12.5px] text-right"><span className="inline-block bg-indigo/20 border border-indigo/30 rounded-2xl rounded-br-sm px-3 py-1.5 text-slate-200">{m.me}</span></div> : <div key={i} className="text-[12.5px]"><span className="inline-block bg-white/[.05] border border-line rounded-2xl rounded-bl-sm px-3 py-1.5 text-slate-200">{m.mira}</span></div>)}
      <div ref={endRef}/>
    </div>
    <div className="mt-2 flex gap-2"><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&ask()} placeholder="Type your question…" className="flex-1 bg-white/[.03] border border-line rounded-xl px-3 py-2 text-[13px] outline-none focus:border-indigo"/><button onClick={ask} className="btn-primary px-4 py-2 rounded-xl text-[13px]">Ask</button></div>
  </div>);
}

/* ============================== CHALLENGE ============================== */
function Challenge({state, dispatch, setRoute, openChart}){
  const accessible = SCENARIOS.filter(s=> s.free || state.premium);
  const next = accessible.find(s=> !state.solved.includes(s.id)) || accessible[accessible.length-1];
  const [sc,setSc]=useState(next);
  const opts=useMemo(()=>shuffle(sc.options),[sc.id]);
  const [chosen,setChosen]=useState(null),[submitted,setSubmitted]=useState(false);
  const [usedHint,setUsedHint]=useState(false),[showHint,setShowHint]=useState(false);
  const [tries,setTries]=useState(0),[time,setTime]=useState(150);
  const [award,setAward]=useState(null);
  const timer=useRef(null);
  useEffect(()=>{ setChosen(null);setSubmitted(false);setUsedHint(false);setShowHint(false);setTries(0);setTime(150);setAward(null); },[sc.id]);
  useEffect(()=>{ if(submitted)return; timer.current=setInterval(()=>setTime(t=>clamp(t-1,0,999)),1000); return ()=>clearInterval(timer.current); },[submitted, sc.id]);
  const health = sc.difficulty>=4 ? clamp(100 - tries*22,0,100) : 100;
  const solvedAccessible = accessible.filter(s=>state.solved.includes(s.id)).length;
  const submit=()=>{ if(chosen==null)return; if(!opts[chosen].correct){ setTries(t=>t+1); setSubmitted(true); return; } clearInterval(timer.current); const pts=scoreFor(sc.difficulty, tries===0, usedHint, time>90); setSubmitted(true); setAward({pts,badge:sc.badge}); dispatch({type:'solve', scenario:sc, pts, badge:sc.badge}); };
  const advance=()=>{ const remFree=SCENARIOS.filter(s=>s.free&&!state.solved.includes(s.id)&&s.id!==sc.id); if(sc.free&&remFree.length===0&&!state.premium){ setRoute('payment'); return; } const pool=SCENARIOS.filter(s=>(s.free||state.premium)&&!state.solved.includes(s.id)&&s.id!==sc.id); if(pool.length)setSc(pool[0]); else setRoute('dashboard'); };
  const correctChosen = submitted && chosen!=null && opts[chosen].correct;
  const dom=DOMAINS.find(d=>d.key===sc.domain); const awardPts=useCountUp(award?award.pts:0,700);
  const chartName={gantt:'Gantt',risk:'Risk heatmap',evm:'EVM',burndown:'Burndown',raci:'RACI'}[sc.chart];
  return (<div className="max-w-6xl mx-auto px-6 py-8">
    <div className="flex flex-wrap items-center gap-3 mb-6"><button onClick={()=>setRoute('home')} className="text-mute hover:text-white text-[13px] flex items-center gap-1.5">◀ Map</button><Chip tone="brand">{dom.icon} {dom.label}</Chip><Chip>Stage {sc.stage}</Chip><Chip tone="gold">{'★'.repeat(sc.difficulty)}<span className="text-mute2">{'★'.repeat(5-sc.difficulty)}</span></Chip><span className="text-[12px] text-mute2">Solved {solvedAccessible}/{accessible.length}</span><span className={`ml-auto font-mono text-[13px] tabular-nums ${time<30?'text-bad':'text-mute'}`}>⏱ {fmtTime(time)}</span>{sc.difficulty>=4 && (<div className="flex items-center gap-2 w-44"><span className="text-[11px] uppercase tracking-wider text-mute">Health</span><Bar pct={health} tone="health"/></div>)}</div>
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 card ring-soft p-7 md:p-8">
        <div className="flex items-center justify-between"><Kicker>Decision required</Kicker>{sc.chart&&<button onClick={()=>openChart(sc.chart)} className="text-[12px] text-indigo hover:underline">↗ Open {chartName} in Lab</button>}</div>
        <h2 className="display text-[clamp(1.8rem,3vw,2.4rem)] mt-4 leading-tight">{sc.title}</h2>
        <p className="mt-4 text-[15.5px] text-slate-200 leading-relaxed">{sc.prompt}</p>
        <div className="mt-7 space-y-3">{opts.map((o,i)=>{ let cls='border-line hover:border-line2 hover:bg-white/[.04]'; if(submitted){ if(o.correct)cls='border-good/60 bg-good/[.08]'; else if(i===chosen)cls='border-bad/60 bg-bad/[.08]'; else cls='border-line opacity-50'; } else if(i===chosen)cls='border-indigo/70 bg-indigo/[.1] shadow-[0_0_0_1px_rgba(109,107,245,.4)]'; return (<button key={i} disabled={submitted&&correctChosen} onClick={()=>!submitted&&setChosen(i)} className={`w-full text-left px-5 py-4 rounded-2xl border transition-all flex items-center gap-3.5 ${cls}`}><span className="grid place-items-center w-7 h-7 rounded-lg bg-white/5 border border-line text-[12px] font-semibold shrink-0">{String.fromCharCode(65+i)}</span><span className="text-[14.5px]">{o.t}</span>{submitted&&o.correct&&<span className="ml-auto text-good text-lg">✓</span>}{submitted&&i===chosen&&!o.correct&&<span className="ml-auto text-bad text-lg">✕</span>}</button>); })}</div>
        {!submitted && (<button onClick={submit} disabled={chosen==null} className="btn-primary mt-7 px-8 py-3.5 rounded-2xl text-[15px] disabled:opacity-30 disabled:shadow-none">Submit decision ▸</button>)}
        {submitted && (<div className={`mt-7 rounded-2xl border p-5 animate-rise ${correctChosen?'border-good/40 bg-good/[.05]':'border-bad/40 bg-bad/[.05]'}`}>
          <div className="flex items-center gap-3"><span className={`grid place-items-center w-9 h-9 rounded-xl text-lg ${correctChosen?'bg-good/15 text-good':'bg-bad/15 text-bad'}`}>{correctChosen?'⚡':'✕'}</span><div className="font-semibold text-[15px]">{correctChosen?<>Solid call. <span className="gradtext ml-1">+{awardPts} XP</span></>:'Not quite — here\'s what happened.'}</div></div>
          {correctChosen ? (<div className="mt-4 grid gap-2.5 text-[14px]"><p><span className="text-mute font-medium">Outcome → </span>The situation stabilises and trust holds.</p><p><span className="text-mute font-medium">Why → </span>{sc.why}</p><p><span className="text-mute font-medium">Even better → </span>{sc.better}</p>{award&&award.badge&&<div className="mt-1"><Chip tone="good">🏅 Badge unlocked — {award.badge}</Chip></div>}</div>):(<div className="mt-4 grid gap-2.5 text-[14px]"><p><span className="text-mute font-medium">Why this hurts → </span>{sc.why}</p><p className="text-mute italic">{MENTOR}: "Reset and look again — strip the distractor details first."</p></div>)}
          <div className="mt-5 flex gap-3">{correctChosen?<button onClick={advance} className="btn-primary px-6 py-3 rounded-xl text-[14px]">Next challenge →</button>:<button onClick={()=>{setSubmitted(false);setChosen(null);}} className="btn-ghost px-6 py-3 rounded-xl text-[14px] font-medium">Try again</button>}<button onClick={()=>setRoute('dashboard')} className="btn-ghost px-6 py-3 rounded-xl text-[14px] font-medium">Dashboard</button></div>
        </div>)}
      </div>
      <div className="card ring-soft p-6 h-fit lg:sticky lg:top-24">
        <div className="flex items-center gap-3.5"><div className="relative"><div className="w-12 h-12 rounded-2xl btn-primary grid place-items-center text-xl">✦</div><span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-good border-2 border-ink animate-glow"/></div><div><div className="font-semibold text-[15px]">{MENTOR}</div><div className="text-[12px] text-mute">Your AI mentor · online</div></div></div>
        <p className="mt-5 text-[14px] text-slate-200 bg-white/[.03] border border-line rounded-2xl p-4 leading-relaxed">"{sc.coach}"</p>
        {!submitted && (showHint?<p className="mt-3 text-[13.5px] text-warn bg-warn/[.07] border border-warn/25 rounded-2xl p-4 animate-rise leading-relaxed">💡 Identify what's relevant vs noise, then pick the option that protects the project's core objective — not the easiest or loudest one.</p>:<button onClick={()=>{setShowHint(true);setUsedHint(true);}} className="btn-ghost mt-3 w-full text-[13.5px] py-2.5 rounded-xl">💡 Reveal hint <span className="text-mute2">(−10 XP)</span></button>)}
        <AskMira sc={sc}/>
        {sc.chart && <button onClick={()=>openChart(sc.chart)} className="btn-ghost mt-3 w-full text-[13.5px] py-2.5 rounded-xl">↗ Practise the {chartName} chart</button>}
        <div className="divider my-6"/><div className="text-[11px] uppercase tracking-[.2em] text-mute">Adaptive engine</div>
        <p className="mt-3 text-[13.5px] text-slate-300 leading-relaxed">{state.solved.length===0?"Calibrating to your baseline — difficulty adjusts to every answer.":`Tracking ${state.solved.length}/${SCENARIOS.length} solved. ${state.premium?'Premium crises unlocked.':'Clear the free track to face Senior PM crises.'}`}</p>
        <div className="mt-4 flex items-center justify-between text-[11px] text-mute mb-2"><span>Current difficulty</span><span>{sc.difficulty}/5</span></div><Bar pct={clamp(sc.difficulty*20,10,100)}/>
      </div>
    </div>
  </div>);
}

/* ============================== EXAM ============================== */
function Exam({state, dispatch, setRoute}){
  const qs = useMemo(()=> EXAM_IDS.map(id=>{ const s=SCENARIOS.find(x=>x.id===id); return {...s, options:shuffle(s.options)}; }), []);
  const [started,setStarted]=useState(false);
  const [idx,setIdx]=useState(0),[chosen,setChosen]=useState(null),[answers,setAnswers]=useState([]),[time,setTime]=useState(720),[finished,setFinished]=useState(false);
  const timer=useRef(null);
  useEffect(()=>{ if(!started||finished)return; timer.current=setInterval(()=>setTime(t=>{ if(t<=1){ clearInterval(timer.current); finish([...answers]); return 0; } return t-1; }),1000); return ()=>clearInterval(timer.current); },[started,finished,answers]);
  if(!state.premium){ return (<div className="max-w-3xl mx-auto px-6 py-16 text-center"><Chip tone="gold">◆ Premium</Chip><h1 className="display text-4xl mt-5">Certification Exam</h1><p className="text-mute mt-3">The timed exam and certificate unlock with the $49 premium upgrade.</p><button onClick={()=>setRoute('challenge')} className="btn-primary mt-7 px-7 py-3.5 rounded-2xl">Go earn your stripes →</button></div>); }
  const finish=(ans)=>{ clearInterval(timer.current); const correct=ans.filter(Boolean).length; const pct=Math.round(correct/qs.length*100); setFinished(true); if(pct>=70) dispatch({type:'certify', score:pct, pts:600}); };
  const submit=()=>{ if(chosen==null)return; const ok=qs[idx].options[chosen].correct; const ans=[...answers,ok]; setAnswers(ans); setChosen(null); if(idx+1<qs.length) setIdx(idx+1); else finish(ans); };
  if(!started){ return (<div className="max-w-3xl mx-auto px-6 py-16"><div className="card ring-soft p-10 text-center"><Chip tone="gold">◆ Final assessment</Chip><h1 className="display text-4xl mt-5">Certification Exam</h1><p className="text-mute mt-3 max-w-md mx-auto">{qs.length} situational questions spanning all five domains, with answers shuffled. 12-minute limit. No hints. Score 70%+ to earn your shareable certificate.</p><div className="mt-6 flex justify-center gap-6 text-[13px] text-mute"><span>📋 {qs.length} questions</span><span>⏱ 12:00</span><span>🎯 70% to pass</span></div><button onClick={()=>setStarted(true)} className="btn-gold mt-8 px-8 py-3.5 rounded-2xl">Begin exam →</button></div></div>); }
  if(finished){ const correct=answers.filter(Boolean).length; const pct=Math.round(correct/qs.length*100); const passed=pct>=70;
    return (<div className="max-w-2xl mx-auto px-6 py-16 text-center"><div className="card ring-soft p-10"><Ring pct={pct} size={150} label={pct+'%'} sub={passed?'Passed':'Score'}/><h1 className="display text-4xl mt-5">{passed?'You passed! 🎉':'Not quite this time'}</h1><p className="text-mute mt-3">{correct}/{qs.length} correct. {passed?'Your certificate is ready.':'You need 70%. Review the scenarios and retake — your progress is saved.'}</p><div className="mt-7 flex gap-3 justify-center">{passed?<button onClick={()=>setRoute('cert')} className="btn-gold px-7 py-3.5 rounded-2xl">View certificate →</button>:<button onClick={()=>{setStarted(false);setFinished(false);setIdx(0);setAnswers([]);setTime(720);}} className="btn-primary px-7 py-3.5 rounded-2xl">Retake exam</button>}<button onClick={()=>setRoute('challenge')} className="btn-ghost px-7 py-3.5 rounded-2xl">Practise more</button></div></div></div>); }
  const q=qs[idx]; const dom=DOMAINS.find(d=>d.key===q.domain);
  return (<div className="max-w-3xl mx-auto px-6 py-8">
    <div className="flex items-center gap-3 mb-5"><Chip tone="brand">{dom.icon} {dom.label}</Chip><span className="text-[13px] text-mute">Question {idx+1} / {qs.length}</span><span className={`ml-auto font-mono text-[14px] tabular-nums ${time<60?'text-bad':'text-mute'}`}>⏱ {fmtTime(time)}</span></div>
    <Bar pct={(idx/qs.length)*100}/>
    <div className="card ring-soft p-7 md:p-8 mt-5"><h2 className="display text-2xl leading-tight">{q.title}</h2><p className="mt-3 text-[15px] text-slate-200 leading-relaxed">{q.prompt}</p>
      <div className="mt-6 space-y-3">{q.options.map((o,i)=>(<button key={i} onClick={()=>setChosen(i)} className={`w-full text-left px-5 py-4 rounded-2xl border transition flex items-center gap-3.5 ${chosen===i?'border-indigo/70 bg-indigo/[.12]':'border-line hover:border-line2 hover:bg-white/[.04]'}`}><span className="grid place-items-center w-7 h-7 rounded-lg bg-white/5 border border-line text-[12px] font-semibold">{String.fromCharCode(65+i)}</span><span className="text-[14.5px]">{o.t}</span></button>))}</div>
      <button onClick={submit} disabled={chosen==null} className="btn-primary mt-6 px-8 py-3.5 rounded-2xl disabled:opacity-30">{idx+1<qs.length?'Next question →':'Finish exam →'}</button>
    </div>
  </div>);
}

/* ============================== CERTIFICATE ============================== */
function Certificate({state, setRoute}){
  const id = state.certId || 'PMQ-2026-'+String(1000+(state.score||0)+state.pmp%900).slice(0,5);
  const verify='https://pmsimlab.com/verify/'+id;
  const dateStr = (state.certDate ? new Date(state.certDate) : new Date()).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const shareText=`I earned the PM Decision-Making credential from PM Sim Lab — ${state.score ?? 0}% on the decision-making assessment. Verify: ${verify}`;
  const enc=encodeURIComponent, share={
    x:`https://twitter.com/intent/tweet?text=${enc(shareText)}`,
    linkedin:`https://www.linkedin.com/sharing/share-offsite/?url=${enc(verify)}`,
    facebook:`https://www.facebook.com/sharer/sharer.php?u=${enc(verify)}`,
    whatsapp:`https://wa.me/?text=${enc(shareText)}`,
  };
  const [copied,setCopied]=useState(false);
  const copy=()=>{ navigator.clipboard&&navigator.clipboard.writeText(verify); setCopied(true); setTimeout(()=>setCopied(false),1800); };
  const SBtn=({href,bg,label,sym})=>(<a href={href} target="_blank" rel="noopener" className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium text-white transition hover:brightness-110" style={{background:bg}}>{sym} {label}</a>);
  return (<div className="max-w-3xl mx-auto px-6 py-12">
    <div className="card ring-soft p-2 print:shadow-none">
      <div className="rounded-[18px] border border-gold/30 p-10 text-center relative overflow-hidden" style={{background:'radial-gradient(120% 90% at 50% 0%, rgba(233,200,121,.10), transparent 60%)'}}>
        <div className="absolute inset-3 rounded-[14px] border border-gold/15 pointer-events-none"/>
        <div className="relative">
          <div className="flex items-center justify-center gap-2 text-gold"><span className="grid place-items-center w-9 h-9 rounded-xl btn-gold text-base">◆</span><span className="font-semibold tracking-tight">PM Sim Lab</span></div>
          <div className="text-[11px] uppercase tracking-[.35em] text-mute mt-6">Skills Credential</div>
          <h1 className="display text-4xl mt-4">Certified in PM Decision-Making</h1>
          <p className="text-mute mt-5 text-[14px]">This certifies that</p>
          <div className="display text-3xl goldtext mt-2">{state.auth?.name || 'PM Sim Lab Member'}</div>
          <p className="text-mute mt-4 text-[14px] max-w-md mx-auto">has demonstrated applied project-management decision-making across {SCENARIOS.length} situational scenarios, five chart competencies, and a timed assessment — spanning risk, stakeholders, planning, Agile and budget.</p>
          <div className="mt-8 flex items-center justify-center gap-10 text-[12px]"><div><div className="text-mute2">Exam score</div><div className="text-white font-semibold text-[15px]">{state.score ?? 0}%</div></div><div><div className="text-mute2">Date</div><div className="text-white font-semibold text-[15px]">{dateStr}</div></div><div><div className="text-mute2">Credential ID</div><div className="text-white font-semibold text-[15px]">{id}</div></div></div>
          <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-mute2"><span>🔒 Verify at {verify.replace('https://','')}</span></div>
        </div>
      </div>
    </div>
    <div className="no-print mt-6">
      <div className="text-center text-[12px] uppercase tracking-[.2em] text-mute mb-3">Share your achievement</div>
      <div className="flex flex-wrap gap-2.5 justify-center">
        <SBtn href={share.linkedin} bg="#0a66c2" label="LinkedIn" sym="in"/>
        <SBtn href={share.x} bg="#111" label="X / Twitter" sym="𝕏"/>
        <SBtn href={share.facebook} bg="#1877f2" label="Facebook" sym="f"/>
        <SBtn href={share.whatsapp} bg="#25d366" label="WhatsApp" sym="✆"/>
        <button onClick={copy} className="btn-ghost flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium">{copied?'Link copied ✓':'🔗 Copy link'}</button>
      </div>
      <div className="mt-5 flex flex-wrap gap-3 justify-center"><button onClick={()=>window.print()} className="btn-primary px-6 py-3 rounded-2xl text-[14px]">⬇ Download / Print PDF</button><button onClick={()=>setRoute('dashboard')} className="btn-ghost px-6 py-3 rounded-2xl text-[14px] font-medium">Back to dashboard</button></div>
    </div>
  </div>);
}

/* ============================== DASHBOARD ============================== */
function Dashboard({state, setRoute, openGate}){
  const total = SCENARIOS.length + 5 + 1;
  const doneCount = state.solved.length + state.missions.length + (state.certified?1:0);
  const certPct = clamp(Math.round(doneCount/total*100),0,100);
  const allBadges=['Path Finder','Risk Whisperer','Stakeholder Diplomat','Sprint Saver','EVM Analyst','Truth Teller','Schedule Surgeon','Crisis Commander','Contingency Architect','Cool-Headed Closer'];
  const sorted=[...DOMAINS].sort((a,b)=>(state.mastery[a.key]||0)-(state.mastery[b.key]||0)); const weak=sorted[0], strong=sorted[sorted.length-1];
  const pmp=useCountUp(state.pmp); const rank=useCountUp(clamp(900-state.pmp,12,999)); const [copied,setCopied]=useState(false);
  const examReady = state.premium && state.solved.length>=FREE_COUNT+3;
  return (<div className="max-w-6xl mx-auto px-6 py-8">
    <div className="flex items-end justify-between flex-wrap gap-4"><div><Kicker>Your dashboard</Kicker><h1 className="display text-[clamp(2rem,3.6vw,2.8rem)] mt-3">Welcome back, {(state.auth?.name||'there').split(' ')[0]}.</h1><p className="text-mute text-[14px] mt-1">{state.premium?'Senior PM':'Junior PM'} · Level {state.level} · <span className="text-warn">🔥 {state.streak}-day streak</span></p></div><button onClick={()=>setRoute('challenge')} className="btn-primary px-6 py-3.5 rounded-2xl text-[14px]">Continue training →</button></div>
    <div className="mt-8 grid lg:grid-cols-3 gap-5">
      <div className="card card-hover p-6"><div className="text-[11px] uppercase tracking-[.2em] text-mute">Total XP earned</div><div className="display text-5xl gradtext mt-3">{pmp.toLocaleString()}</div><div className="text-[13px] text-mute mt-2">{state.solved.length}/{SCENARIOS.length} scenarios · {state.missions.length}/5 challenges · {state.badges.length} badges</div></div>
      <div className="card card-hover p-6 flex items-center gap-5"><Ring pct={certPct} label={certPct+'%'} sub="Program"/><div><div className="text-[11px] uppercase tracking-[.2em] text-mute">Certification</div><div className="text-[15px] mt-2 leading-snug text-slate-200">{state.certified?'Decision-Making certified ✓':state.premium?(examReady?'Assessment unlocked':'Premium track active'):'Locked — Junior tier'}</div>{!state.premium&&<button onClick={openGate} className="mt-3 goldtext text-[13px] font-medium hover:underline">🔒 Unlock for $49 →</button>}{state.certified?<button onClick={()=>setRoute('cert')} className="mt-3 goldtext text-[13px] font-medium hover:underline">View certificate →</button>:examReady?<button onClick={()=>setRoute('exam')} className="mt-3 text-indigo text-[13px] font-medium hover:underline">Take the exam →</button>:null}</div></div>
      <div className="card card-hover p-6"><div className="text-[11px] uppercase tracking-[.2em] text-mute">Cohort rank</div><div className="display text-5xl mt-3">#{rank}</div><div className="text-[13px] text-mute mt-2">Climbs as you earn XP</div></div>
    </div>
    <div className="mt-5 grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 card p-6"><div className="flex items-center justify-between"><div className="text-[11px] uppercase tracking-[.2em] text-mute">Skill tree · mastery</div><Chip>5 disciplines</Chip></div><div className="mt-6 space-y-4">{DOMAINS.map(d=>{ const m=state.mastery[d.key]||0; return (<div key={d.key} className="flex items-center gap-4"><div className="w-48 flex items-center gap-2.5 text-[14px]"><span className="gradtext">{d.icon}</span>{d.label}</div><div className="flex-1"><Bar pct={m}/></div><div className="w-16 text-right text-[13px] tabular-nums text-mute">{m}%{m>=100?' 🏆':m>=70?' ✓':''}</div></div>); })}</div></div>
      <div className="card p-6 relative overflow-hidden"><div className="absolute -top-16 -right-16 w-40 h-40 bg-indigo/20 blur-3xl rounded-full"/><div className="relative"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-xl btn-primary grid place-items-center text-sm">✦</div><div className="text-[11px] uppercase tracking-[.2em] text-mute">AI coach insights</div></div><p className="mt-4 text-[14px] text-slate-200 leading-relaxed">{state.solved.length===0?`"Run your first scenario and I'll start mapping your strengths."`:`"You're strongest in ${strong.label} (${state.mastery[strong.key]||0}%). I've queued targeted ${weak.label} scenarios to lift your weakest area."`}</p><button onClick={()=>setRoute('challenge')} className="btn-ghost mt-5 w-full py-2.5 rounded-xl text-[13.5px] font-medium">Train weak spot →</button></div></div>
    </div>
    <div className="mt-5 grid lg:grid-cols-3 gap-5 mb-6">
      <div className="card p-6 relative overflow-hidden"><div className="absolute -bottom-16 -left-10 w-44 h-44 bg-gold/15 blur-3xl rounded-full"/><div className="relative"><Chip tone="gold">◆ Refer & earn</Chip><h3 className="display text-xl mt-3">Invite your team</h3><p className="text-[13px] text-mute mt-2 leading-relaxed">Share your code. When a colleague certifies, you both earn <b className="text-white">+500 XP</b> and a bonus scenario pack.</p><div className="mt-4 flex items-center gap-2"><code className="flex-1 text-center bg-white/[.04] border border-line rounded-xl py-2.5 text-[14px] tracking-widest goldtext font-semibold">{((state.auth?.name||'PM').split(' ')[0]).toUpperCase().slice(0,8)}-PM49</code><button onClick={()=>setCopied(true)} className="btn-gold px-4 py-2.5 rounded-xl text-[13px]">{copied?'Copied ✓':'Copy'}</button></div></div></div>
      <div className="card p-6"><div className="text-[11px] uppercase tracking-[.2em] text-mute">Achievements</div><div className="mt-4 flex flex-wrap gap-2"><span className="text-[12px] text-mute2 w-full mb-1">{state.badges.length}/{allBadges.length} unlocked</span>{allBadges.map(b=>{ const has=state.badges.includes(b); return <div key={b} className={`px-2.5 py-1.5 rounded-lg border text-[11.5px] flex items-center gap-1.5 transition ${has?'border-good/40 bg-good/[.07] text-white':'border-line text-mute2'}`}><span className={has?'':'opacity-40'}>{has?'🏅':'◇'}</span>{b}</div>; })}</div></div>
      <div className="card p-6"><div className="text-[11px] uppercase tracking-[.2em] text-mute">Recent activity</div><div className="mt-4 space-y-3 text-[14px]">{state.log.length===0&&<p className="text-mute2">No activity yet — go solve something.</p>}{state.log.slice(-6).reverse().map((l,i)=>(<div key={i} className="flex items-center justify-between border-b border-line/60 pb-2.5 last:border-0"><span className="text-slate-300 flex items-center gap-2"><span className="text-good">✓</span>{l.title}</span><span className="gradtext font-medium">+{l.pts}</span></div>))}</div></div>
    </div>
  </div>);
}

/* ============================== APP ============================== */
const initial = { auth:null, pmp:0, level:1, streak:9, premium:false, certified:false, score:0, solved:[], badges:[], missions:[], log:[], mastery:{ risk:20, stake:20, plan:30, agile:15, budget:10 } };
function reducer(s, a){
  switch(a.type){
    case 'login': return {...s, auth:{name:a.name, email:a.email}};
    case 'logout': return {...initial};
    case 'solve': { if(s.solved.includes(a.scenario.id))return s; const mastery={...s.mastery}; mastery[a.scenario.domain]=clamp((mastery[a.scenario.domain]||0)+(10+a.scenario.difficulty*4),0,100); const pmp=s.pmp+a.pts; return {...s,pmp,level:clamp(1+Math.floor(pmp/600),1,6),solved:[...s.solved,a.scenario.id],badges:a.badge&&!s.badges.includes(a.badge)?[...s.badges,a.badge]:s.badges,log:[...s.log,{title:a.scenario.title,pts:a.pts}],mastery}; }
    case 'mission': { if(s.missions.includes(a.key))return s; return {...s, pmp:s.pmp+a.reward, missions:[...s.missions,a.key], log:[...s.log,{title:'Chart challenge',pts:a.reward}]}; }
    case 'premium': return {...s, premium:true};
    case 'certify': if(s.certified)return s; return {...s, certified:true, score:a.score, pmp:s.pmp+a.pts, log:[...s.log,{title:'Certification exam',pts:a.pts}]};
    default: return s;
  }
}
const PROTECTED=['challenge','charts','exam','cert','dashboard','payment'];
function loadState(){ try{ const raw=localStorage.getItem('pmq_state'); if(raw){ const s=JSON.parse(raw); if(s&&s.mastery) return {...initial,...s}; } }catch(e){} return initial; }
export default function App(){
  const [route,setRoute]=useState('home'); const [state,setState]=useState(initial); const [pending,setPending]=useState(null); const [chartTab,setChartTab]=useState('gantt');
  const [theme,setTheme]=useState('light'); const [hydrated,setHydrated]=useState(false); const [userId,setUserId]=useState(null);
  const dispatch=(a)=>setState(s=>reducer(s,a));

  // Hydrate from the localStorage offline cache after mount (avoids SSR/hydration mismatch).
  useEffect(()=>{ setState(loadState()); try{ const t=localStorage.getItem('pmq_theme'); if(t) setTheme(t); }catch(e){} setHydrated(true); },[]);
  useEffect(()=>{ if(hydrated){ try{ localStorage.setItem('pmq_state', JSON.stringify(state)); }catch(e){} } },[state, hydrated]);
  useEffect(()=>{ document.body.classList.toggle('light', theme==='light'); try{ localStorage.setItem('pmq_theme', theme); }catch(e){} },[theme]);
  useEffect(()=>{ window.scrollTo(0,0); },[route]);

  // Returning from Stripe Checkout: the webhook grants the entitlement async, so poll
  // loadRemoteState until premium shows up, then drop the user on the dashboard.
  useEffect(()=>{
    if(typeof window==='undefined') return;
    const p=new URLSearchParams(window.location.search);
    const status=p.get('checkout');
    if(!status) return;
    window.history.replaceState({}, '', window.location.pathname);
    if(status!=='success') return;
    (async()=>{
      for(let i=0;i<6;i++){
        const s=await getSession();
        if(s?.user){ const remote=await loadRemoteState(s.user.id); if(remote){ setState(x=>({...x,...remote})); if(remote.premium) break; } }
        await new Promise(r=>setTimeout(r,1500));
      }
      setRoute('dashboard');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Supabase session is the source of truth for auth: bootstrap once, then subscribe.
  useEffect(()=>{
    let active=true;
    (async()=>{
      const session=await getSession();
      if(!active) return;
      if(session?.user) await hydrateUser(session.user);
      else setState(s=> s.auth? {...s, auth:null} : s);
    })();
    const unsub=onAuthChange(async(session)=>{
      if(session?.user) await hydrateUser(session.user);
      else { setUserId(null); setState({...initial}); }
    });
    return ()=>{ active=false; unsub&&unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Pull the user's cloud state; fall back to session identity if no profile row yet.
  async function hydrateUser(user){
    setUserId(user.id);
    const remote=await loadRemoteState(user.id);
    if(remote) setState(s=>({...initial, ...remote}));
    else setState(s=>({...s, auth:{name:user.user_metadata?.name||user.email?.split('@')[0], email:user.email}}));
  }

  // Persist headline progression to Supabase whenever it changes (signed in only).
  useEffect(()=>{ if(userId) saveProfile(userId, state); },[userId, state.pmp, state.level, state.streak, state.score, state.premium, state.certified, state.badges, state.mastery]);

  // Reconcile per-scenario progress rows (idempotent upserts).
  const syncedRef=useRef(new Set());
  useEffect(()=>{
    if(!userId) return;
    for(const id of state.solved){
      if(syncedRef.current.has(id)) continue;
      syncedRef.current.add(id);
      const sc=SCENARIOS.find(x=>x.id===id); if(!sc) continue;
      const entry=[...state.log].reverse().find(l=>l.title===sc.title);
      recordSolved(userId, { scenarioId:id, title:sc.title, domain:sc.domain, points:entry?entry.pts:0 });
    }
  },[userId, state.solved, state.log]);

  // Issue a certificate row the first time the user becomes certified.
  const certIssuedRef=useRef(false);
  useEffect(()=>{
    if(userId && state.certified && !certIssuedRef.current){
      certIssuedRef.current=true;
      issueCertificate(userId, state.auth?.name||'PM Sim Lab Member', state.score).then(c=>{ if(c?.id) setState(s=>({...s, certId:c.id, certDate:c.issued_at})); });
    }
  },[userId, state.certified]);

  const navigate=(r)=>{ if(PROTECTED.includes(r)&&!state.auth){ setPending(r); setRoute('login'); return; } setRoute(r); };
  const openChart=(k)=>{ setChartTab(k); navigate('charts'); };
  const onLogin=(name,email)=>{ dispatch({type:'login',name,email}); const dest=(pending&&PROTECTED.includes(pending))?pending:'dashboard'; setPending(null); setRoute(dest); };
  const onLogout=async()=>{ await signOut(); syncedRef.current=new Set(); certIssuedRef.current=false; setUserId(null); dispatch({type:'logout'}); setRoute('home'); };
  return (<>
  <div className="aurora" aria-hidden="true">
    <div className="blob animate-drift1" style={{width:520,height:520,left:'-8%',top:'-10%',background:'radial-gradient(circle,#6d6bf5,transparent 70%)'}}/>
    <div className="blob animate-drift2" style={{width:560,height:560,right:'-10%',top:'8%',background:'radial-gradient(circle,#5ec5ff,transparent 70%)',opacity:.35}}/>
    <div className="blob animate-drift1" style={{width:480,height:480,left:'30%',bottom:'-18%',background:'radial-gradient(circle,#8b7cf0,transparent 70%)',opacity:.3}}/>
  </div>
  <div className="min-h-screen" style={{position:'relative',zIndex:2}}>
    <div className="no-print"><Nav route={route} setRoute={navigate} state={state} theme={theme} setTheme={setTheme} onLogout={onLogout}/></div>
    {route==='home' && <Home setRoute={navigate}/>}
    {route==='login' && <Login onLogin={onLogin} setRoute={navigate}/>}
    {route==='payment' && <Payment state={state} onPaid={()=>dispatch({type:'premium'})} setRoute={navigate}/>}
    {route==='challenge' && <Challenge state={state} dispatch={dispatch} setRoute={navigate} openChart={openChart}/>}
    {route==='charts' && <ChartsLab initial={chartTab} state={state} dispatch={dispatch}/>}
    {route==='exam' && <Exam state={state} dispatch={dispatch} setRoute={navigate}/>}
    {route==='cert' && <Certificate state={state} setRoute={navigate}/>}
    {route==='dashboard' && <Dashboard state={state} setRoute={navigate} openGate={()=>navigate('payment')}/>}
    <footer className="no-print border-t border-line mt-8"><div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4 text-[13px] text-mute"><div className="flex items-center gap-2.5"><span className="grid place-items-center w-7 h-7 rounded-lg btn-primary text-[12px]">◆</span>PM <span className="gradtext font-semibold">Sim Lab</span></div><p className="text-mute2">Interactive prototype · scenarios & feedback are AI-generated at runtime in production.</p></div></footer>
  </div>
  </>);
}
