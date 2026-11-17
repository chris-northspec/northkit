import type { Site } from '@northkit/db';
import { Field, SelectField } from '@/components/form/action-form';
import { timeZoneOptions } from '@/lib/time-zones';

/** The depot form's fields, shared by the new and edit pages. */
export function SiteFields({
  site,
  managers,
}: {
  site?: Site;
  managers: { value: string; label: string }[];
}) {
  return (
    <>
      <div className="form-grid">
        <Field
          name="code"
          label="Depot reference"
          hint="Short code for screens and labels, e.g. NTH1."
          defaultValue={site?.code}
          autoCapitalize="characters"
          maxLength={20}
          required
        />
        <Field name="name" label="Depot name" defaultValue={site?.name} required />
      </div>
      <fieldset className="stack">
        <legend>Address</legend>
        <Field
          name="addressLine1"
          label="Address line 1"
          defaultValue={site?.address_line_1 ?? ''}
          autoComplete="address-line1"
        />
        <Field
          name="addressLine2"
          label="Address line 2"
          defaultValue={site?.address_line_2 ?? ''}
          autoComplete="address-line2"
        />
        <div className="form-grid">
          <Field
            name="town"
            label="Town"
            defaultValue={site?.town ?? ''}
            autoComplete="address-level2"
          />
          <Field
            name="postcode"
            label="Postcode"
            defaultValue={site?.postcode ?? ''}
            autoComplete="postal-code"
          />
          <Field
            name="countryCode"
            label="Country code"
            defaultValue={site?.country_code ?? 'GB'}
            maxLength={2}
            autoCapitalize="characters"
          />
        </div>
      </fieldset>
      <div className="form-grid">
        <SelectField
          name="timeZone"
          label="Time zone"
          hint="Due dates and reminders are worked out in this zone."
          options={timeZoneOptions()}
          defaultValue={site?.time_zone ?? 'Europe/London'}
        />
        <SelectField
          name="managerUserId"
          label="Depot manager"
          options={[{ value: '', label: 'Not set' }, ...managers]}
          defaultValue={site?.manager_user_id ?? ''}
        />
        <Field
          name="phone"
          label="Depot phone"
          type="tel"
          defaultValue={site?.phone ?? ''}
          autoComplete="tel"
        />
        <Field
          name="email"
          label="Depot email"
          type="email"
          defaultValue={site?.email ?? ''}
          hint="A shared mailbox, not a person."
        />
      </div>
      <Field
        name="notes"
        label="Notes"
        hint="Access, parking, key holders. No personal health details."
        defaultValue={site?.notes ?? ''}
        maxLength={2000}
      />
    </>
  );
}
