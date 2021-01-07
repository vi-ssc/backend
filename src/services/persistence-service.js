"use strict";

import DataSource from "../datasources";

export const Persistence = {
  async save(model) {
    return DataSource
      .getDataSource(Model.getName(model))
      .save(Model.getId(model), model);
  },

  async find(model) {
    return DataSource
      .getDataSource(Model.getName(model))
      .find(Model.getId(model));
  },

  close() {
    DataSource.close();
  },
};
