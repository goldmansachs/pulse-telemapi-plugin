import _ from 'lodash';
import Suggestion from './suggestion';

export default class TimeseriesApiDatasource {
  withCredentials: boolean;
  headers = {'Content-Type': 'application/json'};
  maxVariableCombination = 1000;
  suggestion: Suggestion;
  // https://github.com/grafana/grafana/blob/main/public/app/features/variables/utils.ts
  varRegex = /\$(\w+)|\[\[([\s\S]+?)(?::(\w+))?\]\]|\${(\w+)(?::(\w+))?}/g;

  /** @ngInject */
  constructor(private instanceSettings, private backendSrv, private templateSrv, private $q, private $http) {
    this.withCredentials = instanceSettings.withCredentials;
    this.suggestion = new Suggestion($http, templateSrv, backendSrv, instanceSettings.url);
  }

  /** Query for timeseries data */
  query(options) {
    options.targets = options.targets.filter(t => !t.hide);
    const targets = this.buildQueryParameters(options);

    if (targets.length <= 0) {
      return this.$q.when({data: []});
    }
    const promiseArray = targets.map(target => {
      const telemApiUrl = this.instanceSettings.url + target.telemApiPath;
      const requestPromise = this.doRequest({
        url: telemApiUrl,
        method: 'GET'
      });
      return requestPromise.then(response => {
        // Enrich target object to the response so that we can refer the alias in transformTelemApiToGrafana
        response.target = target;
        return response;
      });
    });
    const grafanaTimeSeriesDataListPromise = this.$q.all(promiseArray).then(combinedResponse => {
      const multipleTagSingleResponses = [];
      for (let n = 0; n < combinedResponse.length; n++) {
        if (combinedResponse[n].target.alias != undefined) {
          const text = combinedResponse[n].target.alias;
          if (combinedResponse[n].target.customAllStar && text != "" && text.match(this.varRegex) != null) {
            for (let i = 0; i < combinedResponse[n].data.data[0].data.length; i++) {
              const combinedResponseCopy = JSON.parse(JSON.stringify(combinedResponse[n]));
              combinedResponseCopy.data.data[0].data = [];
              const combinedResponseDataCopy = JSON.parse(JSON.stringify(combinedResponse[n].data.data[0].data[i]));
              combinedResponseCopy.data.data[0].data.push(combinedResponseDataCopy);
              multipleTagSingleResponses.push(combinedResponseCopy);
            }
            combinedResponse.splice(n, 1);
            n--;
          }
        }
      }
      for (let r = 0; r < multipleTagSingleResponses.length; r++) {
        combinedResponse.push(multipleTagSingleResponses[r]);
      }
      // Looping through response to apply back the time shift, since Grafana doesn't allow older timestamps on current axis
      for (var s = 0; s < combinedResponse.length; s++) {
        if (combinedResponse[s].data.data != null && combinedResponse[s].data.data[0].data[0] != undefined && combinedResponse[s].target.timeShiftMillis != 0) {
          combinedResponse[s].data.data[0].data[0].timeStampSeries.forEach(dataPoint => dataPoint[0] = dataPoint[0] + combinedResponse[s].target.timeShiftMillis)
        }
      }
      return combinedResponse.map(this.transformTelemApiToGrafana);
    });
    const grafanaTimeSeriesDataPromise = grafanaTimeSeriesDataListPromise.then(
      grafanaTimeSeriesDataList => {
        return {data: _.flatten(grafanaTimeSeriesDataList)};
      }
    );
    return grafanaTimeSeriesDataPromise;
  }

  /**
  * Convert the response from telemetry api to format compatible with Grafana
  * telemApiResponse =>
  *    { resultCode: null,
  *      data: [{
  *       assetDetails: { ... },
  *       data: [{  metricName: "dolor_amet",
  *        tags: { lorem: "ipsum" },
  *        timeStampSeries: [ [1715598781000,7.79], [1715598903000, 8.52] ]  ]}
  *      ]}
  *    }
  * grafanaTimeSeriesData =>
  *    { target: ABC-CPU used"
  *      datapoints: [
  *        [ 13.253333333333332, 1518120652000 ], ]
  *        [ 12345.1234534,      1518120652000 ],...
  *      ]
  *    }
  */
  transformTelemApiToGrafana(telemApiResponse) {
    const grafanaTimeSeriesData = [];
    let alias = undefined;
    let timeShiftAlias = "";
    if (telemApiResponse.target.timeShiftMillis != 0) {
      timeShiftAlias = " - " + telemApiResponse.target.timeShift;
    }
    if (telemApiResponse.data.data == null && telemApiResponse.data.status == "FAILURE" && telemApiResponse.data.messages != null) {
      throw new Error(telemApiResponse.data.messages[0]);
    }
    if (telemApiResponse.target && telemApiResponse.target.alias) {
      alias = telemApiResponse.target.alias;
      if (telemApiResponse.target.customAllStar){
        const tags = telemApiResponse.data.data[0].data[0].tags;
        const tagKeys = Object.keys(tags);
        for (let i = 0; i < tagKeys.length; i++) {
          const dollarVar = "$" + tagKeys[i];
          if (alias.includes(dollarVar)) {
            const tagVal = tags[tagKeys[i]];
            alias = alias.replace(dollarVar, tagVal)
          }
        }
      }
    }
    if (!telemApiResponse || !telemApiResponse.data || !telemApiResponse.data.data) {
      console.log("telemApiResponse false");
      return [];
    }
    if (telemApiResponse.data.data.length === 0) {
      return [];
    }
    const d = telemApiResponse.data.data[0].data;
    d.forEach(elem => {
      const grafanaValueAndTime = elem.timeStampSeries.map(item => [item[1], item[0]]);
      const timeseries = {
        target: alias ? alias + timeShiftAlias : elem.metricName + timeShiftAlias,
        datapoints: grafanaValueAndTime
      };
      grafanaTimeSeriesData.push(timeseries);
    });
    return grafanaTimeSeriesData;
  }

  testDatasource() {
    return this.doRequest({
      url: this.instanceSettings.url + '/health',
      method: 'GET'
    }).then(response => {
      if (response.status === 200) {
        return {
          status: "success",
          message: "Data source is working from Telemetry API",
          title: "Success"
        };
      }
    });
  }

  /** Can be optionally implemented to allow datasource to be a source of annotations for dashboard. */
  annotationQuery(options) {
    throw new Error("Annotation Support not implemented yet.");
  }

  /** Action to query Template variable. */
  metricFindQuery(inputQuery: string) {
    return this.suggestion.metricFindQuery(inputQuery);
  }

  domainListQuery() {
    return this.doRequest({
      url: this.instanceSettings.url + '/_internal/domains',
      method: 'GET'
    }).then(this.mapToTextValue);
  }

  mapToTextValue(result) {
    return _.map(result.data, (d, i) => {
      return {text: d.name, value: d.name};
    });
  }

  doRequest(options) {
    options.withCredentials = this.withCredentials;
    options.headers = this.headers;
    return this.backendSrv.datasourceRequest(options);
  }

  /** Maps the template variable in targets to its selected value */
  listGlobBindings(text, options) {
    const ret = {};
    const scopedVars = _.clone(options.scopedVars || {});
    const variableMatch = text.match(this.varRegex);
    if (!this.templateSrv.variableExists(text)) {
      return ret;
    }
    _.each(variableMatch, (variableWithDollar) => {
      let variableValue = this.templateSrv.replace(variableWithDollar);
      if (!variableValue.includes('{') && !variableValue.includes('}') && variableValue != '*') {
        variableValue = '{' + variableValue + '}';
      }
      const variableWithoutDollar = '$' === variableWithDollar.charAt(0) ?
        variableWithDollar.substr(1) : variableWithDollar.substring(2, variableWithDollar.length - 2);
      const globMatch = variableValue.match(/\{(.+)\}/);
      if (scopedVars.hasOwnProperty(variableWithoutDollar)) {
        ret[variableWithoutDollar] = [ scopedVars[variableWithoutDollar].value ];
      } else if (globMatch) {
        const globValues = globMatch[1].split(",");
        ret[variableWithoutDollar] = globValues;
      }
    });
    return ret;
  }

  /**
  * Construct Telemetry API path from the given target.
  * E.g., telemApiPath:
  * "/esmtelemetryapi/api/v2/timeseries/domain/<domain>?asset=lorem&tags=&startTime=now-6h&
  * endTime=now&aggregator=avg&downsampleInterval=1m&downsampleagg=avg&fillPolicy=none&metric=ipsum&"
  */
  constructTelemApiPathFromTarget(target, options) {
    const domain = target.domain;
    let startTime = options.rangeRaw.from;
    let endTime = options.rangeRaw.to;
    let timeRangePart = "&startTime=" + startTime + "&endTime=" + endTime;
    if (target.timeShift && target.timeShift != null && target.timeShift != "" && target.timeShift != "none") {
      startTime = this.getShiftedTime(startTime, target.timeShift);
      endTime = this.getShiftedTime(endTime, target.timeShift);
      timeRangePart = "&startTime=" + startTime + "&endTime=" + endTime;
    }
    const fromType = typeof options.rangeRaw.from;
    const toType = typeof options.rangeRaw.to;
    if (fromType == "string" && options.rangeRaw.from.includes("/")) {
      if (toType == "string" && options.rangeRaw.to == "now") {
        timeRangePart = "&startTime=" + Date.parse(options.range.from._d).toString() + "&endTime=" + options.rangeRaw.to;
      }
      else {
        timeRangePart = "&startTime=" + Date.parse(options.range.from._d).toString() + "&endTime=" + Date.parse(options.range.to._d).toString();
      }
    }
    const asset = this.templateSrv.replace(target.asset, options.scopedVars);
    const metric = this.templateSrv.replace(target.metric, options.scopedVars);
    const tags = target.hasOwnProperty('tags') ? target.tags : {};
    let combinedTags = '';
    _.forOwn(tags, (tagValue, tagKey) => {
      combinedTags = combinedTags + ',' + tagKey + '=' + this.templateSrv.replace(tagValue);
    });
    combinedTags = (combinedTags.charAt(0) == ',') ? combinedTags.substring(1) : combinedTags;
    const metricAndFormula = this.getMetricAndFormula(target);
    const queryParams = {};
    queryParams['aggregator'] = target.aggregator;
    queryParams['downsampleInterval'] = this.templateSrv.replace(target.downsampleInterval);
    let matchedElements;
    if (queryParams['downsampleInterval'] && (matchedElements = queryParams['downsampleInterval'].match(/auto(\((\d+)\))?/))) {
      /** Automatic calculation of downsample interval:
      *   "auto" -> automatic interval with 100 points (default for auto)
      *   "auto(200)" -> automatic interval with 200 points
      */
      const autoIntervalCount = matchedElements[2] || 100;
      let autoInterval = this.calculateInterval(options.range, autoIntervalCount);
      if (autoInterval.match(/\d\.\d+s/) || autoInterval.match(/\d+ms/)) {
        autoInterval = '1s';
      }
      queryParams['downsampleInterval'] = autoInterval;
    } else {
      queryParams['downsampleInterval'] = this.templateSrv.replace(target.downsampleInterval);
    }
    queryParams['downsampleagg'] = target.downsampleAggregator;
    queryParams['isRate'] = target.shouldComputeRate;
    queryParams['fillPolicy'] = target.fillPolicy;
    queryParams['metric'] = metric;

    if (metricAndFormula.formula) {
      queryParams['formula'] = metricAndFormula.formula.replace(/[+]/g, '%2B');
      queryParams['metric'] = metricAndFormula.metric;
    }
    let telemapiPath = "/esmtelemetryapi/api/v2/timeseries/domain/" + domain
        + "?asset=" + asset + "&tags=" + combinedTags + timeRangePart + '&';
    _.forOwn(queryParams, (paramValue, paramKey) => {
      if (paramValue) {
        telemapiPath += `${paramKey}=${paramValue}&`
      }
    });
    return telemapiPath;
  }

  /**
  *  Handles the timeshift in query options. Overrides the time range
  *  for query by shifting its start and end relative to the time picker
  */
  getShiftedTime(time, timeShift){
    let refTime = time;
    if(time == "now") refTime = new Date().valueOf();
    if(typeof time === 'string' && time.indexOf('-') != -1){
      refTime = new Date().valueOf();
      const trimmedDate = time.split('-')[1];
      const epochMinute = 60000;
      if(trimmedDate.endsWith("m")){
        const factor = parseInt(trimmedDate.split("m")[0]);
        refTime = refTime - (epochMinute * factor);
      }
      if(trimmedDate.endsWith("h")){
        const factor = parseInt(trimmedDate.split("h")[0]);
        refTime = refTime - (epochMinute * 60 * factor);
      }
      if(trimmedDate.endsWith("d")){
        const factor = parseInt(trimmedDate.split("d")[0]);
        refTime = refTime - (epochMinute * 60 * 24 * factor);
      }
    }
    refTime = refTime - this.getTimeShiftInMillis(timeShift);
    return refTime
  }

  getTimeShiftInMillis(timeShift){
    const epochMinute = 60000;
    if (timeShift == undefined) return 0;
    if (timeShift == "none" || timeShift == "") return 0;
    if (timeShift.endsWith("h")) return(epochMinute * 60 * timeShift.split("h")[0]);
    if (timeShift.endsWith("d")) return(epochMinute * 60 * 24 * timeShift.split("d")[0]);
    if (timeShift.endsWith("w")) return(epochMinute * 60 * 24 * timeShift.split("w")[0] * 7);
    return 0;
  }

  /** Handles the different formats for entering formula */
  getMetricAndFormula(target){
    const retVal = {'metric':'', 'formula':''};
    if (target.isFormula) {
      if (target.formula) {
        const trimmedFormula = target.formula.trim();
        const splitByDoubleEquals = trimmedFormula.split('==');
        const fomulaParts = splitByDoubleEquals[0].split('=');
        if (fomulaParts.length >= 2 && !fomulaParts[0].match(/[><]/)) {
          retVal.metric = fomulaParts[0];
          retVal.formula = trimmedFormula;
        } else if (fomulaParts.length == 1) {
          retVal.metric = 'telemetry_api_temp_metric_name';
          retVal.formula = retVal.metric + '=' + trimmedFormula;
        } else {
          retVal.metric = target.metric;    // default to metric
        }
      } else {
        retVal.metric = target.metric;  // default to metric
      }
    } else {
      retVal.metric = target.metric;    // default to metric
    }
    return retVal;
  }

  /** Handles the cases where the value of targets is being decided by template variables */
  buildTargetsByTemplateVariables(originalTarget, options) {
    const ret = [];
    const variableBindings = {};
    // E.g., { "instance": "$core" }
    const targetTags = originalTarget.tags || {};
    let tmpBindings = {};
    for (const tagKey in targetTags) {
      const tagValue = targetTags[tagKey];
      tmpBindings = this.listGlobBindings(tagValue, options);
      // E.g., { "core" : ["0", "1", "2", "3"] }
      Object.assign(variableBindings, tmpBindings);
    }
    if (this.templateSrv.variableExists(originalTarget.metric)) {
      tmpBindings = this.listGlobBindings(originalTarget.metric, options);
      Object.assign(variableBindings, tmpBindings);
    }
    if (this.templateSrv.variableExists(originalTarget.asset)) {
      tmpBindings = this.listGlobBindings(originalTarget.asset, options);
      Object.assign(variableBindings, tmpBindings);
    }
    if (this.templateSrv.variableExists(originalTarget.alias)) {
      tmpBindings = this.listGlobBindings(originalTarget.alias, options);
      Object.assign(variableBindings, tmpBindings);
    }
    let timeShiftMillis = 0;
    if (originalTarget.timeShift != "" || originalTarget.timeShift != "none" || originalTarget.timeShift != null) {
      timeShiftMillis = this.getTimeShiftInMillis(originalTarget.timeShift);
    }
    let isCustomAllStar = false;
    if (!_.isEmpty(variableBindings)) {
      /** Example value for variableBindings:
      *   { percentile: ["50"],  source: ["nasd", "arca", "bats", "nysel", "cta", "utp"] }
      *   scopedVarsList is to have all combination of variable values:
      *    [ {percentile: "50", source: "nasd"},
      *      {percentile: "50", source: "arca"},
      *      ...
      *      {percentile: "50", source: "utp"} ]
      */
      const scopedVarsListRaw = this.generateScopedVarsFromBindings(variableBindings);

      // The number of variable combinations (especially when ALL is used) easily explode and
      // may cause issue in our backend. So let's limit the possible number of combinations
      if (scopedVarsListRaw.length > this.maxVariableCombination) {
        console.log(`The number of combination of variables (${scopedVarsListRaw.length}). Truncating to the limit of ${this.maxVariableCombination}`);
      }
      const scopedVarsList = scopedVarsListRaw.slice(0, this.maxVariableCombination);

      for (const scopedVars of scopedVarsList) {
        const copiedTarget = _.cloneDeep(originalTarget);
        const tags = copiedTarget.tags || {};
        let aliasAfterInterpolation = this.templateSrv.replace(copiedTarget.alias, scopedVars);
        for (const tagk of Object.keys(tags)) {
          const tagv = copiedTarget.tags[tagk];
          const tagvAfterInterpolation = this.templateSrv.replace(tagv, scopedVars);
          copiedTarget.tags[tagk] = tagvAfterInterpolation;
          if (tagvAfterInterpolation == "*" && copiedTarget.alias.includes(tagk)) {
            aliasAfterInterpolation = aliasAfterInterpolation.replace("*", tagv);
            isCustomAllStar = true;
          }
        }
        copiedTarget.asset = this.templateSrv.replace(copiedTarget.asset, scopedVars);
        copiedTarget.metric = this.templateSrv.replace(copiedTarget.metric, scopedVars);
        if (copiedTarget.isFormula) {
          copiedTarget.formula = this.templateSrv.replace(copiedTarget.formula, scopedVars);
        }
        const telemApiPath = this.constructTelemApiPathFromTarget(copiedTarget, options);
        if (telemApiPath.includes("&aggregator=none") || (aliasAfterInterpolation && aliasAfterInterpolation.includes("$"))) {
            isCustomAllStar = true;
        }
        const targetAfterVariableReplace = {
          telemApiPath: telemApiPath,
          refId: copiedTarget.refId,
          hide: copiedTarget.hide,
          type: copiedTarget.type || 'timeseries',
          alias: aliasAfterInterpolation,
          customAllStar: isCustomAllStar,
          timeShift: copiedTarget.timeShift,
          timeShiftMillis: timeShiftMillis
        };
        ret.push(targetAfterVariableReplace);
      }
    } else {
      const telemApiPath = this.constructTelemApiPathFromTarget(originalTarget, options);
      if (telemApiPath.includes("=*") || telemApiPath.includes("&aggregator=none")) {
          isCustomAllStar = true;
      }
      const t = {
        telemApiPath: telemApiPath,
        refId: originalTarget.refId,
        hide: originalTarget.hide,
        type: originalTarget.type || 'timeseries',
        alias: originalTarget.alias,
        customAllStar: isCustomAllStar,
        timeShift: originalTarget.timeShift,
        timeShiftMillis: timeShiftMillis
      };
      ret.push(t)
    }
    return ret;
  }

  /** Recursively generates possible combination of variable value combinations */
  generateCombinationOfBindings(variableNameList, variableValueList, index, bindings, answers) {
    if (index >= variableValueList.length || index >= variableNameList.length) {
      answers.push(bindings);
      return;
    }
    // This doesn't come with $ or [[]]. e.g., percentile
    const variableName = variableNameList[index];
    const variableValues = variableValueList[index];
    for (const variableValue of variableValues) {
      const tmpBinding = _.clone(bindings);
      tmpBinding[variableName] = {
        'text' : variableValue,
        'value' : variableValue
      };
      this.generateCombinationOfBindings(variableNameList, variableValueList, index+1, tmpBinding, answers);
    }
  }

  /** generate an array for template variables key that are referenced in the panel mapped to the value selected.  */
  generateScopedVarsFromBindings(variableBindings) {
    const bindingValueList = [];
    const bindingNameList = [];
    for (const variableName in variableBindings) {
      const values = variableBindings[variableName];
      bindingValueList.push(values);
      bindingNameList.push(variableName);
    }
    const answers = [];
    this.generateCombinationOfBindings(bindingNameList, bindingValueList, 0, {}, answers);
    return answers;
  }

  buildQueryParameters(options) {
    const validTargets = _.filter(options.targets, target => {
      return target.domain && (target.domain !== 'select domain') && target.asset && target.metric;
    });
    const unflattenedTargets = validTargets.map(target => {
      // This may return array of targets depending on template variables
      return this.buildTargetsByTemplateVariables(target, options);
    });
    const ret = _.flatten(unflattenedTargets);
    return ret;
  }

  suggestQuery(target, queryType) {
    return this.suggestion.suggestQuery(target, queryType);
  }

  calculateInterval(range, resolution) {
    // calculate the interval and select the max of interval and 1ms.
    const intervalMs = Math.max(1, ((range.to.valueOf() - range.from.valueOf()) / resolution));
    return this.formatDuration(intervalMs / 1000);
  }

  /** converts the given duration in seconds to a more human readable format.  */
  formatDuration(seconds) {
    const timeUnits = [
      {  unit: 'y', seconds: '31536000'},
      {  unit: 'd', seconds: '86400'},
      {  unit: 'h', seconds: '3600'},
      {  unit: 'm', seconds: '60'},
      {  unit: 's', seconds: '1'},
      {  unit: 'ms', seconds: '0.001'},
    ];

    for(let t of timeUnits) {
      const tsec : any = t.seconds;
      const tunit : any = t.unit;
      const v = Math.floor(seconds / tsec);
      if (v > 0) {
        return v + tunit;
      }
      seconds %= tsec;
    }
    return 'just now';
  }

}
