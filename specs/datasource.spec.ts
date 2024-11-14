import TimeseriesApiDatasource from '../src/datasource';
import * as sinon from 'sinon';

const telemAPIResponse = {
  "data": {
    "data": [
      { "assetDetails": { "name": "testHost", "id": null, "domain": "dummy", "type": "promql", "customErrorMsg": null},
        "data": [
          { "metricName": "testMetric",
            "tags": {},
            "timeStampSeries": [
              [1718844849000,5.128],
              [1718845150000,6.63],
              [1718845451000,5.212],
              [1718845752000,5.34],
              [1718846053000,5.214],
              [1718846354000,5.532]
            ],
            "error": "NO_ERROR",
            "forecast": false
          }
        ]
      }
    ],
    "host": "testHost",
    "messages": null,
    "resultCode": null,
    "status": "SUCCESS",
    "timeTakenMs": 5,
    "retriable": false
  },
  "target": {
    "alias": undefined,
    "custonAllStar": false,
    "refId": "A",
    "telemAPIPath": "/esmtelemetryapi/api/v2/timeseries/domain/dummy?asset=testHost&tags=&startTime=now-6h&endTime=now&aggregator=avg&downsampleInterval=5m&downsampleagg=avg&fillPolicy=none&metric=testMetric&",
    "timeShift": "none",
    "timeShiftMillis": 0,
    "type": "timeseries"
  }
}

describe('Datasource', function () {
  global.window = {
    location: {
      origin: {
        value: 'http://mock.com'
      }
    }
  }

  const instanceSettings = sinon.stub();
  instanceSettings.withCredentials = sinon.stub();
  const backendSrv = sinon.stub();
  const templateSrv = sinon.stub();
  const q = sinon.stub();
  const http = sinon.stub();

  const datasourceInstance = new TimeseriesApiDatasource(instanceSettings, backendSrv, templateSrv, q, http);

  it('should convert telemetry API response to Grafana Response', function () {
    const actualResponse = datasourceInstance.transformTelemApiToGrafana(telemAPIResponse);
    sinon.assert.match(actualResponse[0].target, telemAPIResponse.data.data[0].data[0].metricName);
    sinon.assert.match(actualResponse[0].datapoints.length, telemAPIResponse.data.data[0].data[0].timeStampSeries.length);
  });

  it('should throw error when telemetry api response has Status FAIL or null data', function () {
    telemAPIResponse.data.data = null;
    telemAPIResponse.data.status = "FAILURE";
    telemAPIResponse.data.messages = ["Dummy message: Something is wrong."];
    let errorCaught = false;
    let errorMsg = null;

    try {
      datasourceInstance.transformTelemApiToGrafana(telemAPIResponse);
    } catch (error) {
      errorCaught = true;
      errorMsg = error.message;
    }
    sinon.assert.match(errorCaught, true);
    sinon.assert.match(errorMsg, telemAPIResponse.data.messages[0]);
  });

  it('should calculate correct duration given seconds', function () {
    sinon.assert.match(datasourceInstance.formatDuration(15), '15s');
    sinon.assert.match(datasourceInstance.formatDuration(300), '5m');
    sinon.assert.match(datasourceInstance.formatDuration(4500), '1h');
    sinon.assert.match(datasourceInstance.formatDuration(63000), '17h');
    sinon.assert.match(datasourceInstance.formatDuration(18921600), '219d');
    sinon.assert.match(datasourceInstance.formatDuration(32254848), '1y');  // 366days
  });

  it('should calculate auto interval for downsample', function () {
    const currTime : any = new Date();
    const range : any = { to: currTime, from: currTime - 6*60*60*1000};
    const resolution = 100;
    const expectedAutoInterval = '3m';
    const actualAutoInterval = datasourceInstance.calculateInterval(range, resolution);

    sinon.assert.match(actualAutoInterval, expectedAutoInterval);
  });

});
