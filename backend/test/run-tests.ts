import { cidrTests } from './cidr.test';
import { authServiceTests } from './auth-service.test';
import { auditQueryDtoTests } from './audit-query-dto.test';
import { auditServiceTests } from './audit-service.test';
import { geofeedServiceTests } from './geofeed-service.test';
import { geofeedDtoTests } from './geofeed-dto.test';
import { prefixesServiceTests } from './prefixes-service.test';
import { capacityExactTests } from './capacity-exact.test';
import { dashboardServiceTests } from './dashboard-service.test';
import { settingsDtoTests } from './settings-dto.test';
import { loginThrottleTests } from './login-throttle.test';
import { originAllowlistTests } from './origin-allowlist.test';
import type { TestCase } from './test-utils';

const suites: Array<{ name: string; tests: TestCase[] }> = [
  { name: 'CIDR', tests: cidrTests },
  { name: 'Exact capacity', tests: capacityExactTests },
  { name: 'Dashboard', tests: dashboardServiceTests },
  { name: 'AuthService', tests: authServiceTests },
  { name: 'LoginThrottle', tests: loginThrottleTests },
  { name: 'Origin allowlist', tests: originAllowlistTests },
  { name: 'AuditQueryDto', tests: auditQueryDtoTests },
  { name: 'AuditService', tests: auditServiceTests },
  { name: 'PrefixesService', tests: prefixesServiceTests },
  { name: 'GeofeedService', tests: geofeedServiceTests },
  { name: 'Geofeed DTO', tests: geofeedDtoTests },
  { name: 'Settings DTO', tests: settingsDtoTests },
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
