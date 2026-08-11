import Empty from './command-empty.svelte';
import Group from './command-group.svelte';
import Input from './command-input.svelte';
import Item from './command-item.svelte';
import List from './command-list.svelte';
import Root from './command.svelte';

// Trimmed from shadcn-svelte "nova"'s full command registry item (which
// also includes Dialog/LinkItem/Loading/Separator/Shortcut variants) to
// just the pieces a Popover-wrapped combobox needs — this project has no
// command-palette (Cmd+K) use case to justify the rest.
export {
	Root,
	Empty,
	Group,
	Item,
	Input,
	List,
	//
	Root as Command,
	Empty as CommandEmpty,
	Group as CommandGroup,
	Item as CommandItem,
	Input as CommandInput,
	List as CommandList
};
