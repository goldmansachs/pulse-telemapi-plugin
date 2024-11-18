import _ from 'lodash';

export default class Suggestion {
  storeBaseUrl = '';
  /**
  * metadataLookback: query past X secs of metadata
  * TODO: Right now all the datasources of telemetry plugin have metadataLookback
  * same value. We can make this variable a datasource config. Users will define
  * the lookback period in datasource.yaml when initializing a datasource which
  * could be accessed in datasource.ts through instanceSettings object.
  */
  metadataLookback = 3600

  constructor(private $http, private templateSrv, private backendSrv, private datasourceUrl) {
    this.storeBaseUrl = window.location.origin + datasourceUrl + '/metadata';
  }

  /**
  * Provides autocomplete suggestions like query builder for
  * telemetry query by querying promql metadata endpoints
  * queryType: give suggestion for this field [asset, metric or tag]
  * target: query object
  */
  suggestQuery(target, queryType) {
    const domain = target.domain;
    if (!domain)  return Promise.resolve([]);

    // query metric only if asset is non-empty
    if ( (queryType === 'asset') || (queryType == 'metric' && target.asset)) {
      return this.suggestAssetandMetric(target, domain, queryType);
    } else if (queryType === 'tags') {
      return this.suggestTags(target, domain);
    } else {
      // Unknown query type
      return Promise.resolve([]);
    }
  }

  /**
  * Query metadata from label endpoint and return a list of unique metrics/asset for a given domain
  * Label Values endpoint - https://prometheus.io/docs/prometheus/latest/querying/api/#querying-label-values
  */
  suggestAssetandMetric(target, domain, queryType) {
    let selectorQuery = '', url = '', requestId = '';
    domain = this.templateSrv.replace(domain);
    if(queryType == 'asset') {
      const asset = this.templateSrv.replace(target.asset);
      url = this.storeBaseUrl + "/label/asset/values?";
      selectorQuery = `{domain="${domain}", asset=~"${asset}.*"}`;
      requestId = 'suggestAsset';   // https://community.grafana.com/t/cancel-backendsrv-datasourcerequest/31295
    } else {
      const metric = this.sanitizeKey(this.templateSrv.replace(target.metric));
      const asset = this.templateSrv.replace(target.asset);
      url = this.storeBaseUrl + "/label/__name__/values?";
      selectorQuery = `{__name__=~"${metric}.*", domain="${domain}", asset=~"${asset}"}`;
      requestId = 'suggestMetric';  // https://community.grafana.com/t/cancel-backendsrv-datasourcerequest/31295
    }
    const currTime = Math.round(Date.now()/1000);
    const params = {
      "match[]": selectorQuery,
      "start": currTime - this.metadataLookback,
      "end": currTime
    }
    const query = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    const options = {
      url: url + query,
      method: 'GET',
      requestId: requestId
    };
    return this.backendSrv.datasourceRequest(options).then(response => {
      if(!response || !response.data || !response.data.data )  return [];
      return response.data.data.sort();
    })
  }

  /**
  * Query metadata and return a list of unique tag key-value pair for given domain-metric-asset
  * Series endpoint - https://prometheus.io/docs/prometheus/latest/querying/api/#finding-series-by-label-matchers
  */
  suggestTags(target, domain) {
    const asset = this.templateSrv.replace(target.asset);
    const metric = this.sanitizeKey(this.templateSrv.replace(target.metric));
    const requestId = 'suggestTags' // https://community.grafana.com/t/cancel-backendsrv-datasourcerequest/31295
    domain = this.templateSrv.replace(domain);
    if(!asset || !metric)  return [];
    const url = this.storeBaseUrl + "/series?";
    // match[] = <metricname>{domain="<domainname>",asset="<assetname>"}
    const params = { "match[]" : metric + "{domain=\"" + domain + "\",asset=\"" + asset + "\"}" }
    const query = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    const options = {
      url: url + query,
      method: 'GET',
      requestId: requestId
    };
    return this.backendSrv.datasourceRequest(options).then(response => {
      if(!response.data || !response.data.data)  return [];
      const data = response.data.data;
      const tagsList = [];
      const tagKeys = {};
      data.forEach(tagObj => {
        delete tagObj.__name__;
        delete tagObj.asset;
        delete tagObj.domain;
        const keys = Object.keys(tagObj);
        Object.assign(tagKeys, tagObj);
        for(const key of keys) {
          tagsList.push({'key': key, 'value': tagObj[key]});
        }
      })
      const flattenedTagAndVariables = _.flatten(tagsList); // [{key: "instance", value: "0"}, {key: "instance", value: "1"}]
      const variables = this.templateSrv.variables || [];
      const templateVariableKeys = variables.map(v => v.name);
      for (const key of Object.keys(tagKeys)) {
        if(key === undefined)   return [];
        for (const templateVariableKey of templateVariableKeys) {
          flattenedTagAndVariables.push({'key': key, 'value': '$' + templateVariableKey});
        }
      }
      return _.uniqWith(flattenedTagAndVariables, _.isEqual);
    })
  }

  sanitizeKey(metric) {
    return metric.replace(/[./\\-]/g, "_");
  }

  // Sanitization is needed to support old dashboards after migration to new Prometheus-compatible database
  sanitizeQueryValue(value, key) {
    let sanitizedValue = this.removeWhitespace(value); // remove trailing spaces
    sanitizedValue = this.removeTrailingForwardSlash(sanitizedValue); // remove backslash at start and end of string (/)
    sanitizedValue = (key === 'metric') ? this.sanitizeKey(sanitizedValue) : sanitizedValue; // sanitize the metricname before applying filter on the value
    sanitizedValue = (key === 'tags.key') ? this.sanitizeKey(sanitizedValue) : sanitizedValue;
    sanitizedValue = this.sanitizeAndFilterValue(sanitizedValue); // apply general filters on values once the metric and tag keys are sanitized
    return sanitizedValue;
  }

  /**
  * Support template variables.
  * Convert template query to PromQL query and return the label value/key by querying metadata endpoint
  * inputQuery: Template query. example= domain:"lorem" AND asset:"lorem_ipsum" AND metric:"lorem.ipsum.dolor" | tags.amet
  */
  metricFindQuery(inputQuery: string) {
    const lastIndex = inputQuery.lastIndexOf("|");
    const queryAndPath = [];
    queryAndPath[0] = inputQuery.substring(0,lastIndex);
    queryAndPath[1] = inputQuery.substring(lastIndex+1);
    // Read query and path, trim them, remove all ( and )
    const queryTrimmed = this.templateSrv.replace(queryAndPath[0]).replace(/^\s+|\s+$|\(|\)/g, "");
    const path = this.templateSrv.replace(queryAndPath[1]).replace(/^\s+|\s+$|\(|\)/g, "");

    const target = {
      'domain':"",
      'asset':"",
      'metric':"",
      'tags.key':[],
      'tags.value':[]
    };
    const matchers = queryTrimmed.split("AND");
    matchers.forEach(ele => {
      const p =  ele.split(":");  // e.g., ['domain','system']
      let key = this.removeWhitespace(p[0]);  // e.g., domain
      key = (key === '_type') ? 'domain' : key; // if the query param is _type, use domain
      const value = this.sanitizeQueryValue(p[1], key);
      if(key === 'tags.key' || key === 'tags.value'){
        target[key].push(value);
      }else{
        target[key] = value;
      }
    })
    const options = {
      url: '',
      method: 'GET',
    };
    // e.g., "tags.filesystemName"
    const isTagsQuery = (path.indexOf("tags") === 0);
    return isTagsQuery ? this.getTemplateValuesFromSeries(target, path, options) : this.getTemplateValuesFromLabel(target, path, options);
  }

  /**
  * Build label value endpoint query for template variables for metric and asset path
  * Return the list of asset/metrics that match the filters
  * Label Values endpoint - https://prometheus.io/docs/prometheus/latest/querying/api/#querying-label-values
  */
  getTemplateValuesFromLabel(target, path, options) {
    if(!target.domain)  return;
    // metrics are stored as __name__ in prometheus
    if(path === "metric")  path = "__name__";
    const url = this.storeBaseUrl + "/label/" + path + "/values?";
    const queryUrl = this.buildMatcherFromTemplateTarget(target);
    options.url = url + queryUrl;
    return this.backendSrv.datasourceRequest(options).then(
      (response) => {
        if(_.isEmpty(response.data) || _.isEmpty(response.data.data))  return [];
        const list = [];
        response.data.data.forEach(value => {
          const obj = {"text": value, "expandable": true}
          list.push(obj)
        })
        return _.sortBy(list, 'text');
      }
    )
  }

  /**
  * Build series endpoint query for template variables for tag path
  * Return the list of label value or label-key-value pair that match the query
  * Series endpoint - https://prometheus.io/docs/prometheus/latest/querying/api/#finding-series-by-label-matchers
  */
  getTemplateValuesFromSeries(target, path, options) {
    if(!target.domain || !target.asset)  return;
    const url = this.storeBaseUrl + "/series?";
    const queryUrl = this.buildMatcherFromTemplateTarget(target);
    options.url = url + queryUrl;
    return this.backendSrv.datasourceRequest(options).then(response => {
      if(!response.data || !response.data.data)  return [];
      const data = response.data.data;
      const tagsList = [];
      if(path === 'tags'){
        // get all the tag key value pair
        data.forEach(tagObj => {
          delete tagObj.__name__;
          delete tagObj.asset;
          delete tagObj.domain;

          const keys = Object.keys(tagObj);
          keys.forEach((key,index) => {
            // [{text: '$key:$value', expandable: true}, {...}, ...]
            tagsList.push({'text': `${key}:${tagObj[key]}`, 'expandable': true});
          })
        })
      } else {
        // get only the value of tag matching the tag key. e.g., path = tags.instance
        const tagValue = this.sanitizeKey(path.slice(path.indexOf('.') + 1)); // sanitize tagKey in query type
        data.forEach(tagObj => {
          delete tagObj.__name__;
          delete tagObj.asset;
          delete tagObj.domain;
          if(tagValue in tagObj){
            // [{text: 'tagObj[tagValue]', expandable: true}, {...}, ...]
            tagsList.push({'text': tagObj[tagValue], 'expandable': true});
          }
        })
      }
      tagsList.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i)
      return _.sortBy(tagsList, 'text');
    })
  }

  /**
  * Build a matcher for template queries from target
  * returns, query -> "match[]={domain=~"system",asset=~"hostname.com"}&start=1716357415&end=1716361015"
  */
  buildMatcherFromTemplateTarget(target) {
    const domainQuery = !_.isEmpty(target.domain) ? `domain=~"${target.domain}"` : "";
    const metricQuery = !_.isEmpty(target.metric) ? `,__name__=~"${target.metric}"` : "";
    const assetQuery = !_.isEmpty(target.asset) ? `,asset=~"${target.asset}"` : "";
    let tagsValueQuery = ''
    let tagsQuery = ''
    if(target['tags.value'].length === 0) {
      tagsValueQuery = '.*'
    } else {
      target['tags.value'].forEach(val => {
        tagsValueQuery += val + "|"
      })
    }
    target['tags.key'].forEach(key => {
      tagsQuery += `,${key}=~"${tagsValueQuery}"`
    })
    const param = `{${domainQuery}${metricQuery}${assetQuery}${tagsQuery}}`;
    const currTime = Math.round(Date.now()/1000);
    const params = {
      "match[]": param,
      "start": currTime - this.metadataLookback,
      "end": currTime
    }
    const query = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    return query;
  }

  containsObject(obj, list) {
    const res = _.find(list, function(val){ return _.isEqual(obj, val)});
    return (_.isObject(res)) ? true:false;
  }

  sanitizeAndFilterValue(string) {
    // Remove trailing spaces, character "", replace * with .* and replace ',' with | (as OR)
    string = this.removeWhitespace(string);
    string = string.replace(/\"/g, "").replace(/\*/g, ".*").replace(/,/g, "|");
    return string;
  }

  removeTrailingForwardSlash(string) {
    if(string.startsWith("/"))  string = string.slice(1);
    if(string.endsWith("/"))  string = string.slice(0,-1);
    return string;
  }

  removeWhitespace(string) {
    return string.replace(/\s/g, "");
  }
}
