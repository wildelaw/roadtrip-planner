// Tool definitions (OpenAI function-calling schema) + dispatch table.
// Web tools call the Ollama Cloud endpoints via ollama.js; write-back tools mutate the trip via store.js.
// EV tools (add_charging_stop, set_min_soc) are only injected when trip.vehicle is set.

import { aiConfig } from '../settings.js';
import { webSearch, webFetch } from './transport.js';
import {
  getTrip, addItineraryItem, setDayPlan, setDayMeta, addActivityToDay, addExpense, setBudget,
  addBudgetEstimate, collectionAdd, addChecklistItem, addChecklistCategory, addKeyTip,
} from '../store.js';
import { serializeTrip } from './prompt.js';
import { fmtMoney } from '../utils/format.js';

// ---- Schemas ----
const WEB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information (hours, prices, events, transport). Cloud mode only.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch and read the content of a URL found via web_search. Cloud mode only.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
];

const PLANNING_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_trip_summary',
      description: 'Read the current trip (dates, days, existing items, budget, collections). Use before planning to avoid duplicates.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_itinerary_item',
      description: 'Add one item to a specific day of the trip.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO date YYYY-MM-DD of the day' },
          dayIndex: { type: 'integer', description: '0-based day index (alternative to date)' },
          type: { type: 'string', enum: ['activity', 'transport', 'lodging', 'note'] },
          title: { type: 'string' },
          time: { type: 'string', description: 'HH:MM 24h, optional' },
          location: { type: 'string' },
          cost: { type: 'number' },
          currency: { type: 'string' },
          durationMin: { type: 'integer' },
          confirmation: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_day_plan',
      description: 'Replace an entire day plan with multiple items at once. Prefer this when planning a full day.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          dayIndex: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['activity', 'transport', 'lodging', 'note'] },
                title: { type: 'string' }, time: { type: 'string' }, location: { type: 'string' },
                cost: { type: 'number' }, currency: { type: 'string' }, durationMin: { type: 'integer' }, notes: { type: 'string' },
              },
              required: ['title'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_day_meta',
      description: 'Set per-day meta: a title, drive summary, stay, summary text, dining list, or tips. Companion to set_day_plan.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string' }, dayIndex: { type: 'integer' },
          title: { type: 'string' }, drive: { type: 'string' }, stay: { type: 'string' },
          summary: { type: 'string' }, dining: { type: 'array', items: { type: 'string' } }, tips: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_activity_to_day',
      description: 'Add a place/activity from the location library to a specific day as an itinerary item.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' },
          time: { type: 'string' }, notes: { type: 'string' },
        },
        required: ['date', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_lodging',
      description: 'Record a lodging stay (where you sleep). Use for check-in/out, area, notes.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' }, checkIn: { type: 'string', description: 'YYYY-MM-DD' },
          checkOut: { type: 'string' }, area: { type: 'string' }, notes: { type: 'string' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_reservation',
      description: 'Record something that needs booking, with a deadline and how to book.',
      parameters: {
        type: 'object',
        properties: {
          what: { type: 'string' }, when: { type: 'string' }, bookBy: { type: 'string' },
          cost: { type: 'string' }, howToBook: { type: 'string' }, priority: { type: 'string', enum: ['high', 'med', 'low'] },
        },
        required: ['what'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_pre_trip_action',
      description: 'Record a pre-trip todo (documents, packing, prep) with category and priority.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' }, category: { type: 'string' }, priority: { type: 'string', enum: ['high', 'med', 'low'] },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_location',
      description: 'Add a place to the location library (POI with summary, lodging, charging, dining, activities).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' }, icon: { type: 'string' }, summary: { type: 'string' },
          lodging: { type: 'string' }, charging: { type: 'array', items: { type: 'string' } },
          dining: { type: 'array', items: { type: 'string' } },
          activities: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, desc: { type: 'string' } } } },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_bucket_item',
      description: 'Add a must-see item to the bucket list (optionally dated).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, date: { type: 'string' }, dateLabel: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_checklist_item',
      description: 'Add an item to a checklist category (creates the category if missing).',
      parameters: {
        type: 'object',
        properties: { category: { type: 'string' }, text: { type: 'string' } },
        required: ['category', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_budget_estimate',
      description: 'Add a budget line item (category + item + cost). Use this to record estimated costs; the budget total rolls up automatically.',
      parameters: {
        type: 'object',
        properties: { category: { type: 'string' }, item: { type: 'string' }, cost: { type: 'string', description: 'free text, e.g. "$450" or "est. $450–600"' }, optional: { type: 'boolean' } },
        required: ['category', 'item'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_contact',
      description: 'Record a useful contact (what it is for + how to reach it).',
      parameters: { type: 'object', properties: { what: { type: 'string' }, how: { type: 'string' } }, required: ['what'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_key_tip',
      description: 'Record a key tip for the trip (a short string of advice).',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_alert',
      description: 'Record a critical alert (e.g. road closure, weather, reservation deadline) with severity.',
      parameters: {
        type: 'object',
        properties: { severity: { type: 'string', enum: ['danger', 'warn'] }, title: { type: 'string' }, text: { type: 'string' } },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_expense',
      description: 'Record an actual expense (real spend) for the trip.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string' }, category: { type: 'string' }, amount: { type: 'number' }, label: { type: 'string' } },
        required: ['amount', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_budget',
      description: 'Set an overall trip budget total and category breakdown (legacy). Prefer add_budget_estimate for line items.',
      parameters: {
        type: 'object',
        properties: {
          total: { type: 'number' },
          categories: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' } } } },
        },
      },
    },
  },
];

const EV_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_charging_stop',
      description: 'Record a charging network/station you plan to use.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' }, location: { type: 'string' }, network: { type: 'string' }, nacsAdapter: { type: 'boolean' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_min_soc',
      description: 'Set a minimum state-of-charge threshold for a driving leg (EV mode).',
      parameters: {
        type: 'object',
        properties: { day: { type: 'string' }, leg: { type: 'string' }, minSoc: { type: 'number' }, reason: { type: 'string' }, severity: { type: 'string', enum: ['danger', 'warn', 'info'] } },
        required: ['minSoc'],
      },
    },
  },
];

// Schema list passed to chat().tools. Web tools are cloud-only (Ollama Cloud has /api/web_search);
// WebGPU and local modes plan from model knowledge. EV tools injected only when trip.vehicle is set.
export function toolSchemas(trip) {
  const isEV = !!(trip && trip.vehicle);
  const cfg = aiConfig();
  const webTools = cfg.isCloud ? WEB_TOOLS : [];
  return [...webTools, ...PLANNING_TOOLS, ...(isEV ? EV_TOOLS : [])];
}

// ---- Dispatch ----
// Execute one tool call. Returns { name, content } where content is the string fed back as role:tool.
export async function dispatchTool(call, tripId, { onTool } = {}) {
  const name = call.function?.name || call.name;
  let args = {};
  try { args = JSON.parse(call.function?.arguments || call.arguments || '{}'); }
  catch { args = {}; }

  const log = (label, detail) => onTool?.({ name, label, detail });

  switch (name) {
    case 'web_search': {
      log(`Searching: "${args.query}"`);
      const res = await webSearch({ query: args.query, maxResults: args.max_results || 5 });
      if (!res.ok) return { name, content: `web_search error: ${res.error?.message || 'failed'}` };
      const text = res.data.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join('\n\n');
      return { name, content: text || 'No results.', citations: res.data.results.map((r) => r.url) };
    }
    case 'web_fetch': {
      log(`Fetching: ${args.url}`);
      const res = await webFetch({ url: args.url });
      if (!res.ok) return { name, content: `web_fetch error: ${res.error?.message || 'failed'}` };
      return { name, content: `Title: ${res.data.title}\nURL: ${args.url}\n\n${res.data.content}`, citations: [args.url] };
    }
    case 'get_trip_summary': {
      log('Reading trip');
      return { name, content: serializeTrip(getTrip(tripId)) };
    }
    case 'add_itinerary_item': {
      log(`Adding item: ${args.title}`);
      const res = await addItineraryItem(tripId, args);
      if (res?.error) return { name, content: `Failed: ${res.error}` };
      return { name, content: `Added "${args.title}" on ${res.day}.` };
    }
    case 'set_day_plan': {
      log(`Setting day plan (${args.items?.length || 0} items)`);
      const res = await setDayPlan(tripId, args);
      if (res?.error) return { name, content: `Failed: ${res.error}` };
      return { name, content: `Set ${res.count} items for ${res.date}.` };
    }
    case 'set_day_meta': {
      log(`Setting day meta for ${args.date || args.dayIndex}`);
      const trip = getTrip(tripId);
      const day = (trip.days || []).find((d) => d.date === args.date) || (args.dayIndex != null ? trip.days[args.dayIndex] : null);
      if (!day) return { name, content: `Failed: no matching day for ${args.date ?? args.dayIndex}.` };
      const patch = {};
      for (const k of ['title', 'drive', 'stay', 'summary', 'dining', 'tips']) if (args[k] != null) patch[k] = args[k];
      await setDayMeta(tripId, day.id, patch);
      return { name, content: `Updated day ${day.date} meta: ${Object.keys(patch).join(', ')}.` };
    }
    case 'add_activity_to_day': {
      log(`Adding activity "${args.title}" to ${args.date}`);
      const res = await addActivityToDay(tripId, args);
      if (res?.error) return { name, content: `Failed: ${res.error}` };
      return { name, content: `Added "${args.title}" to ${res.day}.` };
    }
    case 'add_lodging': {
      log(`Adding lodging: ${args.location}`);
      await collectionAdd(tripId, 'lodging', args);
      return { name, content: `Recorded lodging "${args.location}".` };
    }
    case 'add_reservation': {
      log(`Adding reservation: ${args.what}`);
      await collectionAdd(tripId, 'reservations', args);
      return { name, content: `Recorded reservation "${args.what}"${args.bookBy ? ` (book by ${args.bookBy})` : ''}.` };
    }
    case 'add_pre_trip_action': {
      log(`Adding pre-trip action: ${args.text}`);
      await collectionAdd(tripId, 'preTripActions', { ...args, done: false });
      return { name, content: `Recorded pre-trip action "${args.text}".` };
    }
    case 'add_location': {
      log(`Adding location: ${args.name}`);
      await collectionAdd(tripId, 'locations', args);
      return { name, content: `Added location "${args.name}" to the library.` };
    }
    case 'add_bucket_item': {
      log(`Adding bucket item: ${args.name}`);
      await collectionAdd(tripId, 'bucketList', args);
      return { name, content: `Added "${args.name}" to the bucket list.` };
    }
    case 'add_checklist_item': {
      log(`Adding checklist item [${args.category}] ${args.text}`);
      const trip = getTrip(tripId);
      let cat = (trip.checklists || []).find((c) => c.category.toLowerCase() === String(args.category).toLowerCase());
      if (!cat) cat = await addChecklistCategory(tripId, args.category);
      await addChecklistItem(tripId, cat.id, args.text);
      return { name, content: `Added "${args.text}" to checklist "${args.category}".` };
    }
    case 'add_budget_estimate': {
      log(`Adding budget estimate: ${args.category} / ${args.item}`);
      await addBudgetEstimate(tripId, args);
      return { name, content: `Recorded budget estimate ${args.category}: ${args.item}${args.cost ? ` (${args.cost})` : ''}.` };
    }
    case 'add_contact': {
      log(`Adding contact: ${args.what}`);
      await collectionAdd(tripId, 'contacts', args);
      return { name, content: `Recorded contact "${args.what}".` };
    }
    case 'add_key_tip': {
      log('Adding key tip');
      await addKeyTip(tripId, args.text);
      return { name, content: `Recorded key tip.` };
    }
    case 'add_alert': {
      log(`Adding alert: ${args.title}`);
      await collectionAdd(tripId, 'criticalAlerts', args);
      return { name, content: `Recorded alert "${args.title}".` };
    }
    case 'add_charging_stop': {
      log(`Adding charging stop: ${args.name}`);
      await collectionAdd(tripId, 'chargingNetworks', args);
      return { name, content: `Recorded charging network "${args.name}".` };
    }
    case 'set_min_soc': {
      log(`Setting min SoC ${args.minSoc}% for ${args.leg || args.day || 'a leg'}`);
      await collectionAdd(tripId, 'minSocThresholds', args);
      return { name, content: `Set min SoC ${args.minSoc}% for ${args.leg || args.day || 'leg'}.` };
    }
    case 'add_expense': {
      log(`Adding expense: ${fmtMoney(args.amount)} ${args.category}`);
      const res = await addExpense(tripId, args);
      if (!res) return { name, content: 'Failed to add expense.' };
      return { name, content: `Recorded expense ${fmtMoney(args.amount)} in ${args.category}.` };
    }
    case 'set_budget': {
      log('Setting budget');
      const res = await setBudget(tripId, args);
      return { name, content: `Budget set: ${JSON.stringify(res)}` };
    }
    default:
      return { name, content: `Unknown tool: ${name}` };
  }
}