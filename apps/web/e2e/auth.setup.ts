import { expect, test as setup } from '@playwright/test';
import { E2E } from './global-setup';
import { authFile, nextCode, projectKey, signIn } from './helpers';

// Signs in this project's administrator once (password, then two-factor code) and
// saves the session for the project's tests, so codes are never reused.
setup('sign in the administrator with two-factor', async ({ page }, info) => {
  const project = projectKey(info);
  const fullName = info.project.name.replace(/^auth-/, '');
  await signIn(page, E2E.admin(fullName));
  await expect(page.getByLabel('Code')).toBeFocused();
  await page.getByLabel('Code').fill(nextCode(process.env[`E2E_TOTP_${project}`]!));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL('/');
  await page.context().storageState({ path: authFile(fullName) });
});
