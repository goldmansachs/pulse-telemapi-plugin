import TimeseriesApiDatasource from './datasource';
import {ApiDatasourceQueryCtrl} from './query_ctrl';
import {ApiConfigCtrl} from './config_ctrl';

class ApiAnnotationsQueryCtrl {
  static templateUrl = 'partials/annotations.editor.html';
}

class ApiQueryOptionsCtrl {
  static templateUrl = 'partials/query.options.html'
}

export {
  TimeseriesApiDatasource as Datasource,
  ApiDatasourceQueryCtrl as QueryCtrl,
  ApiConfigCtrl as ConfigCtrl,
  ApiQueryOptionsCtrl as QueryOptionsCtrl,
  ApiAnnotationsQueryCtrl as AnnotationsQueryCtrl
};
