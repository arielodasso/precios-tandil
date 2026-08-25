import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '20s', target: 10 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: [{ threshold: 'p(95)<200', abortOnFail: false }],
    http_req_failed: ['rate<0.1'],
  },
};

const ENDPOINTS = [
  '/healthz',
  '/api/v1/categories',
  '/api/v1/stores',
  '/api/v1/search?q=arroz',
  '/api/v1/deals?status=published',
];

export default function () {
  for (const path of ENDPOINTS) {
    const res = http.get(`${BASE_URL}${path}`);
    check(res, {
      [`${path} status 200`]: (r) => r.status === 200,
      [`${path} latency < 200ms`]: (r) => r.timings.duration < 200,
    });
  }
  sleep(1);
}
