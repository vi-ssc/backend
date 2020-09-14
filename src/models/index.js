import ModelFactory from './model-factory';
import importRemoteModels from '../services/import-remote-models';

const createEventFactory = (model) => ({
  modelData: { ...model }
});

const updateEventFactory = ({ updated, changes }) => ({
  updated: { ...updated },
  changes: { ...changes }
});

export async function initModels() {
  const factory = ModelFactory.getInstance();
  const models = await importRemoteModels();

  models.forEach(model => {
    factory.registerModel({
      modelName: model.modelName,
      fnFactory: model.factory,
      fnIsValid: model.isValid,
      fnUpdated: model.updated,
      mixins: model.mixins,
      isRemote: true,
    });

    factory.registerEvent(
      factory.EventTypes.CREATE,
      model.modelName,
      createEventFactory
    );

    factory.registerEvent(
      factory.EventTypes.UPDATE,
      model.modelName,
      updateEventFactory
    );
  });
}

export default ModelFactory;