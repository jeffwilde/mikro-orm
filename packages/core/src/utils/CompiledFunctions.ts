import type { MetadataStorage } from '../metadata/MetadataStorage.js';
import { ObjectHydrator } from '../hydration/ObjectHydrator.js';
import type { Configuration } from './Configuration.js';
import { EntityComparator } from './EntityComparator.js';

/** @internal */
export function initCompiledFunctions(metadata: MetadataStorage, config: Configuration): void {
  const platform = config.getDriver().getPlatform();
  const hydrator = new ObjectHydrator(metadata, platform, config);
  const comparator = new EntityComparator(metadata, platform, config);

  for (const meta of metadata) {
    hydrator.getEntityHydrator(meta, 'full', false);
    hydrator.getEntityHydrator(meta, 'full', true);
    comparator.getEntityComparator(meta.class);
    comparator.getSnapshotGenerator(meta.class);
    comparator.getResultMapper(meta);

    if (!meta.embeddable && !meta.virtual) {
      hydrator.getEntityHydrator(meta, 'reference', false);
      hydrator.getEntityHydrator(meta, 'reference', true);
    }

    if (meta.primaryKeys.length > 0) {
      comparator.getPkGetter(meta);
      comparator.getPkGetterConverted(meta);
      comparator.getPkSerializer(meta);
    }
  }
}
