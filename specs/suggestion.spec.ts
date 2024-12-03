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
import Suggestion from '../src/suggestion';
import * as sinon from 'sinon';

describe('Suggestion and Template calls', function () {
  global.window = {
    location: {
      origin: {
        value: 'http://mock.com'
      }
    }
  }
  const http = sinon.stub();
  const templateSrv = sinon.stub();
  templateSrv.replace = sinon.stub();
  const backendSrv = sinon.stub();
  backendSrv.datasourceRequest = sinon.stub();
  const url = sinon.stub();

  const suggestionInstance = new Suggestion(http, templateSrv, backendSrv, url);
  const target = { 'domain': '', 'asset': '', 'metric': '', 'tags.key': [], 'tags.value': []};

  it('should return empty Promise if domain is null', function () {
    target.domain = null;
    const actualResponse = suggestionInstance.suggestQuery(target, 'lorem');
    const isPromise = actualResponse instanceof Promise;
    sinon.assert.match(isPromise, true);

    actualResponse.then((val) => {
      sinon.match.array(val);
      sinon.assert.match(val.length, 0);
    });
  });

  it('should redirect suggest calls based on query type', function () {
    target.domain = 'testDomain';
    const suggestAssetandMetricSpy = sinon.stub(suggestionInstance, "suggestAssetandMetric");
    const suggestTagsSpy = sinon.stub(suggestionInstance, "suggestTags");

    // check for query type asset
    suggestionInstance.suggestQuery(target, 'asset');
    sinon.assert.calledOnce(suggestAssetandMetricSpy);

    // check for query type metric
    suggestionInstance.suggestQuery(target, 'metric');
    sinon.assert.calledOnce(suggestAssetandMetricSpy);

    // check for query type tags
    suggestionInstance.suggestQuery(target, 'tags');
    sinon.assert.calledOnce(suggestTagsSpy);
  });

  it('should return sanitized value for template query', function () {
    let key = 'asset';
    let value = '/lorem/ipsum/dolor/.+/  |  placerat4523-*.dc.* ';
    let expectedResponse = 'lorem/ipsum/dolor/.+/|placerat4523-.*.dc..*';
    let actualResponse = suggestionInstance.sanitizeQueryValue(value, key);
    sinon.assert.match(actualResponse, expectedResponse);

    key = 'metric';
    value = 'malesuada.proin.libero*';
    expectedResponse = 'malesuada_proin_libero.*';
    actualResponse = suggestionInstance.sanitizeQueryValue(value, key);
    sinon.assert.match(actualResponse, expectedResponse);
  });

  it('should return template matcher from template target', function () {
    target.domain = 'lorem';
    target.asset = 'ipsum';
    target.metric = 'dolor';
    target['tags.key'].push('malesuada');
    target['tags.value'].push('peito');

    const expectedValueForMatch = `match%5B%5D=%7Bdomain%3D~%22lorem%22%2C__name__%3D~%22dolor%22%2Casset%3D~%22ipsum%22%2Cmalesuada%3D~%22peito%7C%22%7D&`
    const query = suggestionInstance.buildMatcherFromTemplateTarget(target);

    const regex = new RegExp(`${expectedValueForMatch}.*`);
    const isQueryValid = regex.test(query);
    sinon.assert.match(isQueryValid, true);
  })
});