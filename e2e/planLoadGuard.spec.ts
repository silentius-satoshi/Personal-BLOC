import { test, expect, type Page } from '@playwright/test';
import { STORE_VERSION, sheet, waitForSheetAtRest } from './helpers';

// 5c (spec `pbloc-spec-plan-load-guard-v1`) — on a signed-in device that hasn't loaded the plan, the Ledger says logging
// is paused and Save is off (the store refuses the write as well — unit-tested); and the rider: the activity card's
// headline is what was bought, with moves on their own line. Round synthetic figures; no relay is contacted (no signer,
// and no relays in the seed).

const PUBKEY = 'ab'.repeat(32);   // a placeholder identity — nothing is signed or fetched

// A month-1 entry waiting for its sign-off (the strategy starts today), with today's draw behind it. The one-shot
// reconcile is marked done, so the seeded entry stands as written.
function guardSeed(planLoaded: boolean): string {
  return `
    window.__APP_BOOTED = true;
    (function () {
      var d = new Date();
      var today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      localStorage.setItem('personal-bloc-nostr-pubkey', '${PUBKEY}');
      localStorage.setItem('personal-bloc-nostr-auth', '1');
      localStorage.setItem('personal-bloc-nostr-method', 'nip07');
      localStorage.setItem('personal-bloc-provenance', 'external');
      localStorage.setItem('personal-bloc-store', JSON.stringify({
        state: {
          onboardingComplete: true, simpleMode: true, simpleView: 'daily', nostrRelays: [], planLoaded: ${planLoaded},
          advisorStartDate: today, monthBucketReconcileDone: true,
          dayLog: [{ id: 'g-d1', date: today, ts: d.getTime(), kind: 'draw', amount: 500 }],
          monthlyLog: [{ month: 1, date: today, btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0,
            loggedAt: d.getTime(), updatedAt: d.getTime(), expensesActual: 500, source: 'daily', confirmed: false }]
        },
        version: ${STORE_VERSION}
      }));
      localStorage.setItem('personal-bloc-onboarded', '1');
    })();
  `;
}

/** Open the add sheet, choose a cold deposit (it needs no balance reading), type an amount: a sheet Save would accept. */
async function stageColdDeposit(page: Page, seed: string) {
  await page.addInitScript(seed);
  await page.goto('/');
  await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Log an event').click();
  const s = sheet(page);
  await expect(s).toBeVisible();
  await waitForSheetAtRest(s);
  await s.getByRole('button', { name: 'Collateral', exact: true }).click();
  await s.getByRole('tab', { name: 'Cold', exact: true }).click();
  const amount = s.locator('input').first();
  await amount.click();
  await amount.fill('0.01');
  await page.getByRole('dialog').click({ position: { x: 5, y: 5 } });
  return s;
}

test.describe('5c — logging waits for the plan', () => {
  test('⭐ PAUSED — signed in, plan not loaded: the sheet says so and Save is off; no way in to a sign-off', async ({ page }) => {
    const s = await stageColdDeposit(page, guardSeed(false));
    await expect(s.getByText('Logging is paused until your plan loads on this device.')).toBeVisible();
    await expect(s.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await s.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('tab', { name: 'Month', exact: true }).click();
    await expect(page.getByText('Month 1 — confirm your log')).toHaveCount(0);
  });

  test('⭐ LOADED — the same entry with the plan loaded: no note, Save on, the sign-off offered (non-vacuity)', async ({ page }) => {
    const s = await stageColdDeposit(page, guardSeed(true));
    await expect(s.getByText('Logging is paused until your plan loads on this device.')).toHaveCount(0);
    await expect(s.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await s.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('tab', { name: 'Month', exact: true }).click();
    await expect(page.getByText('Month 1 — confirm your log')).toBeVisible();
  });
});

// The owner's September in round figures, on today: two buys of 0.02 ₿ (one pledged to Strike — a buy plus its same-ts
// Strike deposit), and 0.05 ₿ moved from Strike to Coinbase. The card used to read "-0.0100 ₿" over "no Bitcoin bought
// yet". With `signOff`, month 1 (the strategy starts today) waits for its sign-off, so the Ledger offers the review sheet.
function riderSeed(signOff: boolean): string {
  return `
  window.__APP_BOOTED = true;
  (function () {
    var d = new Date();
    var today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    var t = d.getTime();
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: true, simpleView: 'daily', btcPriceMode: 'manual', btcPrice: 100000,
        hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
        dayLog: [
          { id: 'r-b1', date: today, ts: t - 4000, kind: 'buy', amount: 0.02, usd: 2000 },
          { id: 'r-d1', date: today, ts: t - 4000, kind: 'deposit', amount: 0.02, target: 'strike' },
          { id: 'r-b2', date: today, ts: t - 3000, kind: 'buy', amount: 0.02, usd: 2000 },
          { id: 'r-w1', date: today, ts: t - 2000, kind: 'withdraw', amount: 0.05, target: 'strike' },
          { id: 'r-d2', date: today, ts: t - 1000, kind: 'deposit', amount: 0.05, target: 'cb' }
        ]${signOff ? `,
        advisorStartDate: today, monthBucketReconcileDone: true,
        monthlyLog: [{ month: 1, date: today, btcBought: 0.04, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0,
          loggedAt: t, updatedAt: t, expensesActual: 0, source: 'daily', confirmed: false }]` : ''}
      },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  })();
`;
}

test.describe('5c rider — the activity card', () => {
  test('⭐ HEADLINE — bought 0.04: the headline, "stacked", and the move on its own line; in Week and in Month', async ({ page }) => {
    await page.addInitScript(riderSeed(false));
    await page.goto('/');
    await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
    for (const scope of ['Week', 'Month']) {
      await page.getByRole('tab', { name: scope, exact: true }).click();
      await expect(page.locator('[class*="actBig"]')).toHaveText('+0.0400 ₿');
      await expect(page.locator('[class*="actUsd"]'), 'E HEADLINE stacked, to the cent').toHaveText('+$4,000.00 stacked');
      await expect(page.getByTestId('activity-moves')).toHaveText('Moved: Strike −0.0500 ₿ · Coinbase +0.0500 ₿');
      await expect(page.getByText(/no Bitcoin bought/)).toHaveCount(0);
    }
  });

  test('⭐ REVIEW — the sign-off sheet says "Moved", with both places, and no "Net collateral"', async ({ page }) => {
    await page.addInitScript(riderSeed(true));
    await page.goto('/');
    await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: 'Month', exact: true }).click();
    await expect(page.getByText('Month 1 — confirm your log')).toBeVisible();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    const rs = sheet(page);
    await expect(rs).toBeVisible();
    await waitForSheetAtRest(rs);
    await expect(rs.getByText('Review Month 1')).toBeVisible();
    await expect(rs.getByText('Moved', { exact: true })).toBeVisible();
    await expect(rs.getByText('Strike −0.0500 ₿ · Coinbase +0.0500 ₿', { exact: true })).toBeVisible();
    await expect(rs.getByText('Net collateral')).toHaveCount(0);
  });
});
