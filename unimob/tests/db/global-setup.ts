// @ts-expect-error script JS sans types
import { resetDatabase } from '../../scripts/db-reset.mjs';

export default async function setup() {
  const url: string = await resetDatabase({ seed: true });
  process.env.TEST_DATABASE_URL = url;
}
