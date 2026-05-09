import { cidrTests } from './cidr.test';
import { geofeedServiceTests } from './geofeed-service.test';
import { prefixesServiceTests } from './prefixes-service.test';
import type { TestCase } from './test-utils';

const suites: Array<{ name: string; tests: TestCase[] }> = [
  { name: 'CIDR', tests: cidrTests },
  { name: 'PrefixesService', tests: prefixesServiceTests },
  { name: 'GeofeedService', tests: geofeedServiceTests },
];

async function main() {
  let failed = 0;

  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const test of suite.tests) {
      try {
        await test.run();
        console.log(`  ✓ ${test.name}`);
      } catch (error) {
        failed++;
        console.error(`  ✗ ${test.name}`);
        console.error(error);
      }
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exitCode = 1;
    return;
  }

  console.log('\nAll tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
