import { expect, test } from '@playwright/test';

test('Today and Schedule show actions appropriate to the selected screen', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: '이지런', exact: true })).toBeVisible();
  for (const label of ['이번 주 기록 보기', '오늘의 훈련 완료', '전체 설명 읽기', '계획에 사용한 리뷰', '마감은 무엇을 바꾸나요?', '평가 범위와 제한']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: '오늘의 훈련 완료' })).toHaveCount(0);
  await page.goto('/schedule');
  await expect(page.locator('.schedule-row')).toHaveCount(7);
  await expect(page.getByText('계획에 사용한 리뷰')).toHaveCount(0);
});

test('goal and connection settings have separate responsibilities on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/my/goals');
  await expect(page.getByRole('button', { name: '목표 저장하기' })).toBeVisible();
  await expect(page.getByLabel('최근 컨디션', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '훈련 처방 기준' })).toHaveCount(0);
  await page.goto('/garmin-connect');
  await expect(page.getByRole('heading', { name: '연결 설정' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Garmin 주간 기록 가져오기' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /ChatGPT/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '훈련 처방 기준' })).toBeVisible();
  await expect(page.getByText('훈련 준비 데이터', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('saving a race preserves training preferences and editing condition preserves that race', async ({ page }) => {
  const race = {id:'10000000-0000-4000-8000-000000000001',name:'Spring half',priority:'primary',distance:'HALF',date:'2027-03-01',targetTimeSeconds:6000};
  let goal = {races:[race], condition:null, raceName:race.name, targetDistance:'HALF',targetDate:race.date,targetTimeSeconds:6000,trainingDays:[1,3,7],longRunDay:7};
  let saves = 0;
  await page.route('**/api/training/goal', async route => {
    if (route.request().method() === 'PUT') {
      const {expectedRevision,...next}=route.request().postDataJSON();
      expect(expectedRevision).toBe(String(saves).padStart(32,'0'));
      goal=next;
      saves++;
    }
    return route.fulfill({json:{goal,revision:String(saves).padStart(32,'0'),today:'2026-11-25',issues:[],timezone:'America/Los_Angeles'}});
  });
  await page.goto('/my/goals');
  await page.getByLabel('대회 1 이름').fill('Coastal half');
  await page.getByRole('button',{name:'목표 저장하기'}).click();
  await expect.poll(()=>saves).toBe(1);
  expect(goal.trainingDays).toEqual([1,3,7]);
  await page.goto('/my/training');
  await expect(page.getByLabel('대회 1 이름')).toHaveCount(0);
  await page.getByLabel('최근 컨디션',{exact:true}).selectOption('normal');
  await page.getByRole('button',{name:'훈련 설정 저장하기'}).click();
  await expect.poll(()=>saves).toBe(2);
  expect(goal.races[0]).toEqual({...race,name:'Coastal half'});
  expect(goal.condition.feeling).toBe('normal');
});

test('switching races recalculates the remaining preparation phases', async ({page})=>{
  await page.setViewportSize({width:320,height:720});
  await page.route('**/api/training/progress', async route=>{
    const response=await route.fetch(),data=await response.json();
    const race={id:'a',name:'봄 풀코스',distance:'FULL',date:'2027-03-14',priority:'primary',targetTimeSeconds:14400,targetPaceSecondsPerKm:341,
      daysUntil:100,phase:'preparation',taperDays:14,recoveryDays:14,taperStart:'2027-02-28',taperEnd:'2027-03-13',recoveryStart:'2027-03-15',recoveryEnd:'2027-03-28'};
    data.asOfDate='2026-12-04';
    data.races=[race,{...race,id:'b',name:'겨울 하프',distance:'HALF',priority:'supporting',date:'2026-12-10',daysUntil:6,phase:'taper',taperStart:'2026-12-03',taperEnd:'2026-12-09',recoveryStart:'2026-12-11',recoveryEnd:'2026-12-17'}];
    await route.fulfill({response,json:data});
  });
  await page.goto('/roadmap');
  const timeline=page.locator('ol');
  await expect(timeline).toContainText('급수·보급');
  await expect(timeline).toContainText('겨울 하프');
  await page.getByRole('combobox',{name:'대회 선택'}).selectOption('b');
  await expect(timeline.locator('li')).toHaveCount(2);
  await expect(timeline.locator('[aria-current="step"]')).toContainText('테이퍼');
  await expect(timeline).toContainText('2026-12-10');
  await expect(timeline).not.toContainText('기초 지구력');
});
