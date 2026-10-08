import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedMapPosition } from '../lib/map-view.ts';
import { demoData } from '../lib/demo.ts';

test('selected map position changes on movement even when selection stays the same', () => {
    const watches = demoData().watches, selected = watches[0].id;
    const original = selectedMapPosition(watches,selected);
    assert.equal(selectedMapPosition(watches.map(w=>({...w,battery:30})),selected),original);
    assert.notEqual(selectedMapPosition(watches.map(w=>w.id===selected?{...w,location:{...w.location!,latitude:44}}:w),selected),original);
    assert.equal(selectedMapPosition(watches.map(w=>({...w,location:null})),selected),null);
    assert.equal(selectedMapPosition(watches,null),null);
});
