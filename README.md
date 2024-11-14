# Telemetry API Datasource Plugin

**Pulse Telemetry API Plugin** is a datasource plugin for Grafana, to query a custom timeseries-based database. 

It is created and maintained by developers at Goldman Sachs to enable the visualization of timeseries metrics specially designed for custom telemetry APIs for firm's monitoring solution. The plugin uses [Telemetry API](#telemetry-api) to query timeseries data and [PromQL Metadata API](https://prometheus.io/docs/prometheus/latest/querying/api/#querying-metadata) to query series's metadata.

## Requirements

* NodsJS and NPM

## Build

```
npm install
npm test
npm run build
```

<a name="telemetry-api"></a>
## Telemetry API 

- Base pattern

```
http://<base url>/esmtelemetryapi/api/v2/timeseries/domain/<domain>
```

- Parameters

|Parameter   | Description  |   Default |
|---|---|---|
| asset  | Specifies the asset	  | Required  |
| metric  | Specifies what metric you want to retrieve  | Required |
| startTime | Specify the starting time	  | now-1h |
| endTime  | Specify the end time  | now |
| tags	| Map of tags | * |
| aggregator | 	Aggregates results as specified in OpenTSDB documentation | avg |
| downsampleInterval |	The interval used for down-sampling. Must be used with the downsampleagg parameter | 1m |
| downsampleagg	| The aggregator used for down-sampling. Must be used with the downsampleInterval parameter| avg |

## Integrate with Grafana

[Install the plugin](https://grafana.com/docs/grafana/latest/administration/plugin-management/#install-a-packaged-plugin) in Grafana and [allow unsigned plugin](https://grafana.com/docs/grafana/latest/administration/plugin-management/#allow-unsigned-plugins).

## Contributions

Contributions are encouraged! Please see [CONTRIBUTING](CONTRIBUTING.md) for more details.


## Note

The simpleJson_logo.svg file is used as logo which is taken from [Simple JSON datasource](https://github.com/grafana/simple-json-datasource/blob/master/src/img/simpleJson_logo.svg) copyrighted under MIT License.