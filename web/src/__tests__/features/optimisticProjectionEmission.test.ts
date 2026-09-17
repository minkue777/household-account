import { OptimisticEntityProjection } from '@/platform/read-model/optimisticEntityProjection';

type Row = { id: string; aggregateVersion: number; amount: number };
const first: Row = { id: 'a', aggregateVersion: 1, amount: 10 };
const second: Row = { id: 'b', aggregateVersion: 1, amount: 20 };
const createProjection = () => new OptimisticEntityProjection<Row>('test', (left, right) => left.id.localeCompare(right.id));

it('publishes and closes a read-only search without rerendering background sources, and restores only the new retained subscriber', () => {
  const projection = createProjection();
  const background = jest.fn();
  const monthly = projection.subscribe(background, () => true, 'month');
  const source = [second, first];
  monthly.publish(source);
  expect(background).toHaveBeenLastCalledWith([first, second]);
  background.mockClear();
  const searchResult = jest.fn();
  const search = projection.subscribe(searchResult, row => row.amount >= 20);
  search.publish(source);
  expect(searchResult).toHaveBeenLastCalledWith([second]);
  expect(background).not.toHaveBeenCalled();
  search.publish([first]);
  expect(searchResult).toHaveBeenLastCalledWith([]);
  search.dispose();
  expect(background).not.toHaveBeenCalled();
  const restored = jest.fn();
  projection.subscribe(restored, () => true, 'month');
  expect(restored).toHaveBeenCalledWith([first, second]);
  expect(background).not.toHaveBeenCalled();
  expect(source).toEqual([second, first]);
});

it.each(['create', 'update', 'delete'] as const)('keeps cross-source reconciliation on publish/dispose while a %s is pending', kind => {
  const projection = createProjection();
  const background = jest.fn();
  const searchResult = jest.fn();
  const monthly = projection.subscribe(background);
  const search = projection.subscribe(searchResult);
  monthly.publish([first]);
  search.publish([first]);
  const mutation = kind === 'create' ? projection.beginCreate(second)
    : kind === 'update' ? projection.beginUpdate(first.id, { amount: 99 }) : projection.beginDelete(first.id);
  const expected = kind === 'create' ? [first, second] : kind === 'update' ? [{ ...first, aggregateVersion: 2, amount: 99 }] : [];
  background.mockClear();
  searchResult.mockClear();
  monthly.publish([first]);
  expect(background).toHaveBeenLastCalledWith(expected);
  expect(searchResult).toHaveBeenLastCalledWith(expected);
  background.mockClear();
  search.dispose();
  expect(background).toHaveBeenLastCalledWith(expected);
  projection.rollback(mutation);
  expect(background).toHaveBeenLastCalledWith([first]);
});

it('still notifies all sources when a fresh publication clears the last confirmed overlay, then returns to independent reads', () => {
  const projection = createProjection();
  const background = jest.fn();
  const searchResult = jest.fn();
  const monthly = projection.subscribe(background);
  const search = projection.subscribe(searchResult);
  monthly.publish([first]);
  search.publish([first]);
  const mutation = projection.beginUpdate(first.id, { amount: 99 });
  const confirmed = { ...first, aggregateVersion: 2, amount: 99 };
  projection.commitUpdate(mutation, confirmed);
  monthly.publish([confirmed]);
  expect(searchResult).toHaveBeenLastCalledWith([confirmed]);
  background.mockClear();
  search.publish([confirmed]);
  expect(background).toHaveBeenLastCalledWith([confirmed]);
  background.mockClear();
  searchResult.mockClear();
  projection.subscribe(jest.fn()).publish([confirmed]);
  expect(background).not.toHaveBeenCalled();
  expect(searchResult).not.toHaveBeenCalled();
});
