/**
 * Copyright 2024 Goldman Sachs.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
///<reference path="../node_modules/grafana-sdk-mocks-graph-panel/app/headers/common.d.ts" />
import _ from 'lodash';
import {QueryCtrl} from 'app/plugins/sdk';
import './css/query_editor.css!';
import TimeseriesApiDatasource from "./datasource";

export class ApiDatasourceQueryCtrl extends QueryCtrl {
  // Used to render the view when users edit their metrics
  static templateUrl = 'partials/query.editor.html';
  addTagMode: boolean = false;
  datasource: TimeseriesApiDatasource;
  aggregators = ['avg', 'count', 'dev', 'min', 'max', 'none', 'sum', 'zimsum',
    'p50', 'p75', 'p90', 'p95', 'p98', 'p99', 'p999', 'last'];
  fillPolicies = ['none', 'zero', 'nan'];
  minLengthToSuggestAsset = 5;
  minLengthToSuggestMetric = 3;
  defaults = {
  };

  /** @ngInject **/
  constructor(private $scope, $injector, private templateSrv) {
    super($scope, $injector);

    _.defaultsDeep(this.target, this.defaults);

    this.target.domain = this.target.domain || 'select domain';
    this.target.asset = this.target.asset || '';
    this.target.metric = this.target.metric || '';
    this.target.tags = this.target.tags || {};
    this.target.aggregator = this.target.aggregator || 'avg';
    this.target.downsampleInterval = this.target.downsampleInterval || '1m';
    this.target.downsampleAggregator = this.target.downsampleAggregator || 'avg';
    this.target.shouldComputeRate = this.target.shouldComputeRate || false;
    this.target.fillPolicy = this.target.fillPolicy || 'none';
    this.target.timeShift = this.target.timeShift || 'none';
  }

  getOptions(query) {
    return this.datasource.metricFindQuery(query || '');
  }

  getDomains(query) {
    // This returns a future object
    return this.datasource.domainListQuery();
  }

  getAggregators = () => {
    const t = this.aggregators.map((agg) => {
      return {text: agg, value: agg};
    });
    return t;
  };

  getFillPolicies = () => {
    const f = this.fillPolicies.map((fillPolicy) => {
      return {text: fillPolicy, value: fillPolicy};
    });
    return f;
  }

  onChangeInternal() {
    this.panelCtrl.refresh(); // Asks the panel to refresh data.
  }

  suggestAsset = (queryStr, callback) => {
    const query = queryStr || "";
    if (query.length < this.minLengthToSuggestAsset) {
      return [];
    }
    this.target.current_query_asset = query;

    this.datasource.suggestQuery(this.target, 'asset').then(callback);
  };

  suggestMetric = (queryStr, callback) => {
    const query = queryStr || "";
    if (query.length < this.minLengthToSuggestMetric) {
      return [];
    }
    this.target.current_query_metric = query;
    this.datasource.suggestQuery(this.target, 'metric').then(callback);
  };

  toggleEditorMode() {
    this.target.rawQuery = !this.target.rawQuery;
  }

  addTag () {
    if (!this.addTagMode) {
      this.addTagMode = true;
      this.target.domainChanged = true;
      if (this.target.domainChanged || this.target.assetChanged || this.target.metricChanged) {
        const promise = this.datasource.suggestQuery(this.target, 'tags');
        promise.then(result => {
          this.target.possibleTags = _.sortBy(_.uniq(result, x => {
            return x['key'] + x['value'];
          }), 'value');
          this.target.domainChanged = false;
          this.target.assetChanged = false;
          this.target.metricChanged = false;
        });
      }
      return;
    }

    if (!this.target.tags) {
      this.target.tags = {};
    }
    if (this.target.selectedTag && this.target.selectedTag.key) {
      // This shows selected tags as $tagKey = $tagValue at query.editor.html
      // <dev ng-repeat="(key, value) in ctrl.target.tags track by $index" class="">
      this.target.tags[this.target.selectedTag.key] = this.target.selectedTag.value;
      this.target.selectedTag = undefined;
      // This closes the dropdown
      this.addTagMode = false;
    }
  }
  removeTag(tagKey) {
    delete this.target.tags[tagKey];
  }
  cancelAddTagMode() {
    // This closes the dropdown
    this.addTagMode = false;
  }
}
