import type { Item, Kind } from '@northkit/db';
import { penceToPounds } from '@northkit/core';
import { CheckField, Field, SelectField } from '@/components/form/action-form';

/** The item form's fields, shared by the new and edit pages. */
export function ItemFields({
  item,
  kinds,
  depots,
  locations,
  fixedDepot = false,
  hideDepot = false,
}: {
  item?: Item;
  kinds: Pick<Kind, 'id' | 'name'>[];
  depots: { id: string; code: string; name: string }[];
  /** Locations of the chosen depot (an item can only be at a location of its own depot). */
  locations: { id: string; code: string; name: string }[];
  /** On the edit page an item stays at its home depot: shown, not changeable. */
  fixedDepot?: boolean;
  /** The page already carries the depot (a hidden field): show no depot field. */
  hideDepot?: boolean;
}) {
  return (
    <>
      <div className="form-grid">
        <SelectField
          name="kindId"
          label="Kind"
          options={[
            { value: '', label: 'Choose a kind' },
            ...kinds.map((k) => ({ value: k.id, label: k.name })),
          ]}
          defaultValue={item?.kind_id ?? ''}
        />
        {hideDepot ? null : fixedDepot ? (
          <>
            <input type="hidden" name="siteId" value={item?.site_id} />
            <Field
              name="depotShown"
              label="Home depot"
              defaultValue={depots.find((d) => d.id === item?.site_id)?.code ?? ''}
              readOnly
              hint="An item stays at its home depot; moving it is a transfer."
            />
          </>
        ) : (
          <SelectField
            name="siteId"
            label="Home depot"
            options={[
              { value: '', label: 'Choose a depot' },
              ...depots.map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` })),
            ]}
            defaultValue={item?.site_id ?? (depots.length === 1 ? depots[0]!.id : '')}
          />
        )}
        <Field
          name="assetNumber"
          label="Asset number"
          hint="Leave blank to generate the next one, such as LD-000123."
          defaultValue={item?.asset_number ?? ''}
          autoCapitalize="characters"
          maxLength={30}
        />
        <Field name="serialNumber" label="Serial number" defaultValue={item?.serial_number ?? ''} />
        <Field name="make" label="Make" defaultValue={item?.make ?? ''} />
        <Field name="model" label="Model" defaultValue={item?.model ?? ''} />
      </div>
      <Field
        name="description"
        label="Description"
        defaultValue={item?.description ?? ''}
        maxLength={1000}
      />
      <div className="form-grid">
        <Field
          name="purchaseDate"
          label="Purchase date"
          type="date"
          defaultValue={item?.purchase_date ?? ''}
        />
        <Field
          name="cost"
          label="Cost (£)"
          inputMode="decimal"
          hint="What it cost, in pounds and pence, such as 189.50."
          defaultValue={
            item?.cost_pence !== null && item?.cost_pence !== undefined
              ? penceToPounds(Number(item.cost_pence))
              : ''
          }
        />
        <SelectField
          name="locationId"
          label="Where it is now"
          hint={
            locations.length
              ? 'A store, van, yard or job site at the home depot.'
              : 'Add locations to the depot first, or leave blank.'
          }
          options={[
            { value: '', label: 'Not placed yet' },
            ...locations.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` })),
          ]}
          defaultValue={item?.location_id ?? ''}
        />
      </div>
      <fieldset className="stack">
        <legend>Ownership</legend>
        <div className="form-grid">
          <SelectField
            name="ownership"
            label="Owned or hired in"
            options={[
              { value: 'owned', label: 'Owned' },
              { value: 'hired_in', label: 'Hired in' },
            ]}
            defaultValue={item?.ownership ?? 'owned'}
          />
          <Field
            name="hireCompany"
            label="Hire company"
            hint="Only for hired-in kit."
            defaultValue={item?.hire_company ?? ''}
          />
          <Field
            name="hireReference"
            label="Hire reference"
            defaultValue={item?.hire_reference ?? ''}
          />
          <Field
            name="offHireDate"
            label="Off-hire date"
            type="date"
            defaultValue={item?.off_hire_date ?? ''}
          />
        </div>
      </fieldset>
      <CheckField
        name="isKit"
        label="This is a kit that holds other items (for example a harness set)"
        defaultChecked={item?.is_kit ?? false}
      />
      <Field name="notes" label="Notes" defaultValue={item?.notes ?? ''} maxLength={2000} />
    </>
  );
}
