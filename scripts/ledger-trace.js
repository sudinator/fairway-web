"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
// Live ledger trace. Feeds a DB dump (from scripts/ledger-dump.sql) through the REAL lib/money.ts
// functions so we see exactly what the app computes: overall balances, simplified transfers, per-event
// settled-state, and the payment→expense allocations. Usage: node ledger-trace.js <dump.json>
var fs = require("fs");
var money_1 = require("../lib/money");
var file = process.argv[2];
if (!file) {
    console.error("usage: ledger-trace <dump.json>");
    process.exit(1);
}
var raw = JSON.parse(fs.readFileSync(file, "utf8"));
var d = raw.ledger || raw.data || raw;
var members = d.members || [];
var expenses = d.expenses || [];
var shares = d.shares || [];
var payers = d.payers || [];
var settlements = (d.settlements || []).map(function (s) { return (__assign({}, s)); });
var allocations = d.allocations || [];
var events = d.events || [];
var guests = d.guests || [];
var confirmed = settlements.filter(function (s) { return (s.status || "confirmed") === "confirmed"; });
var nameOf = function (id) { var _a; return ((_a = members.find(function (m) { return m.id === id; })) === null || _a === void 0 ? void 0 : _a.display_name) || (id ? String(id).slice(0, 8) : "?"); };
var expName = function (id) {
    if (!id)
        return "(general — unattributed)";
    var e = expenses.find(function (x) { return x.id === id; });
    return e ? (e.description || id.slice(0, 8)) : id.slice(0, 8);
};
console.log("\n============================================================");
console.log("LEDGER TRACE \u2014 ".concat(((_a = d.group) === null || _a === void 0 ? void 0 : _a.name) || "group"));
console.log("members ".concat(members.length, " \u00B7 expenses ").concat(expenses.length, " \u00B7 settlements ").concat(settlements.length, " (").concat(confirmed.length, " confirmed) \u00B7 allocations ").concat(allocations.length, " \u00B7 events ").concat(events.length, " \u00B7 guests ").concat(guests.length));
console.log("============================================================");
// ---- overall balances (the numbers the app's banner/balances use) ----
var bal = (0, money_1.computeBalances)(expenses, shares, confirmed, guests, payers);
console.log("\n-- OVERALL BALANCES (confirmed payments only) --");
var sq = [];
for (var _i = 0, members_1 = members; _i < members_1.length; _i++) {
    var m = members_1[_i];
    var c = bal[m.id] || 0;
    if (c === 0) {
        sq.push(nameOf(m.id));
        continue;
    }
    console.log("   ".concat(nameOf(m.id).padEnd(18), " ").concat(c > 0 ? "is owed" : "owes   ", " ").concat((0, money_1.fmtUSD)(Math.abs(c))));
}
if (sq.length)
    console.log("   (square: ".concat(sq.join(", "), ")"));
var conserve = Object.values(bal).reduce(function (a, b) { return a + b; }, 0);
console.log("   [conservation check: sum of all balances = ".concat(conserve, " (must be 0)]"));
// ---- simplified transfers ----
var tr = (0, money_1.simplify)(bal);
console.log("\n-- SIMPLIFIED \"WHO PAYS WHOM\" --");
if (!tr.length)
    console.log("   (all settled)");
tr.forEach(function (t) { return console.log("   ".concat(nameOf(t.from), " \u2192 ").concat(nameOf(t.to), "   ").concat((0, money_1.fmtUSD)(t.amt))); });
// ---- per event ----
var settle = (0, money_1.eventSettlement)({ events: events, expenses: expenses, shares: shares, payers: payers, settlements: settlements, guests: guests, allocations: allocations });
console.log("\n-- EVENTS --");
var keys = Object.keys(settle).sort(function (a, b) { return (settle[a].date || 0) - (settle[b].date || 0); });
var _loop_1 = function (k) {
    var ev = k ? events.find(function (e) { return e.id === k; }) : null;
    var label = ev ? "".concat(ev.name, " [").concat(ev.status, "]") : "Ungrouped";
    var st = settle[k];
    var verdict = st.settled ? "SETTLED ✓" : "owes ".concat((0, money_1.fmtUSD)(st.owed - st.covered), "  (owed ").concat((0, money_1.fmtUSD)(st.owed), ", covered ").concat((0, money_1.fmtUSD)(st.covered), ")");
    console.log("\n   \u25B8 ".concat(label, " \u2014 ").concat(verdict));
    expenses.filter(function (e) { var _a; return ((_a = e.event_id) !== null && _a !== void 0 ? _a : null) === (k || null); }).forEach(function (e) {
        return console.log("       \u00B7 ".concat((e.description || "expense"), "  ").concat((0, money_1.fmtUSD)(e.amount_cents), "  paid by ").concat(nameOf(e.payer_user_id)));
    });
    var en = (0, money_1.eventNet)((k || null), expenses, shares, guests, payers);
    en.perMember.filter(function (m) { return m.net !== 0; }).sort(function (a, b) { return a.net - b.net; }).forEach(function (m) {
        return console.log("       ".concat(nameOf(m.member_id).padEnd(18), " ").concat(m.net < 0 ? "owes" : "gets", " ").concat((0, money_1.fmtUSD)(Math.abs(m.net))));
    });
};
for (var _b = 0, keys_1 = keys; _b < keys_1.length; _b++) {
    var k = keys_1[_b];
    _loop_1(k);
}
// ---- payment allocations (dispute tracing) ----
if (allocations.length) {
    console.log("\n-- PAYMENT ALLOCATIONS (each payment \u2192 the expenses it cleared) --");
    var _loop_2 = function (s) {
        var al = allocations.filter(function (a) { return a.settlement_id === s.id; });
        if (!al.length)
            return "continue";
        console.log("   ".concat(nameOf(s.from_user_id), " \u2192 ").concat(nameOf(s.to_user_id), "  ").concat((0, money_1.fmtUSD)(s.amount_cents), "  [").concat(s.status || "confirmed", "]"));
        al.forEach(function (a) { return console.log("       ".concat((0, money_1.fmtUSD)(a.amount_cents), " \u2192 ").concat(expName(a.expense_id))); });
    };
    for (var _c = 0, settlements_1 = settlements; _c < settlements_1.length; _c++) {
        var s = settlements_1[_c];
        _loop_2(s);
    }
}
else {
    console.log("\n-- PAYMENT ALLOCATIONS -- (none yet \u2014 pre-0118, or no payments recorded)");
}
console.log("");
