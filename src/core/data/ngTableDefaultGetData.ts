/**
 * ngTable: Table + Angular JS
 *
 * @author Vitalii Savchuk <esvit666@gmail.com>
 * @url https://github.com/esvit/ng-table/
 * @license New BSD License <http://creativecommons.org/licenses/BSD/>
 */

import * as ng1 from 'angular';
import { IFilterFilter, IFilterOrderBy, IFilterService, IParseService, IPromise, IServiceProvider} from 'angular';
import { IFilterFunc } from '../filtering';
import { NgTableParams } from '../ngTableParams';
import { NgTableEventsChannel } from '../ngTableEventsChannel';


/**
 * A default implementation of the getData function that will apply the `filter`, `orderBy` and
 * paging values from the {@link NgTableParams} instance supplied to the data array supplied.
 *
 * A call to this function will:
 * - return the resulting array
 * - assign the total item count after filtering to the `total` of the `NgTableParams` instance supplied
 */
export interface IDefaultGetData<T> {
    (data: T[], params: NgTableParams<T>): T[];
    /**
     * Convenience function that this service will use to apply paging to the data rows.
     *
     * Returns a slice of rows from the `data` array supplied and sets the `NgTableParams.total()`
     * on the `params` instance supplied to `data.length`
     */
    applyPaging(data: T[], params: NgTableParams<any>): T[],
    /**
     * Returns a reference to the function that this service will use to filter data rows
     */
    getFilterFn(params: NgTableParams<T>): IFilterFunc<T>,
    /**
     * Returns a reference to the function that this service will use to sort data rows
     */
    getOrderByFn(params?: NgTableParams<T>): IFilterOrderBy
}

/**
 * Object interface for containing processed sort values.
 */
interface PredicateValue {
    /**
     * The actual value for the predicate.
     */
    value: any,
    /**
     * The type value of the predicate.
     */
    type: string,
    /**
     * The index within the `predicateValues`.
     */
    index: number,
}

/**
 * Object interface for arguments that get compared in the `IFilterOrderBy`.
 */
interface ComparisonObject {
    /**
     * The object that determines the `tieBreaker` for identical `ComparisonObject`s.
     */
    tieBreaker: PredicateValue,
    /**
     * An array of `PredicateValue`s that will be used for sorting.
     */
    predicateValues: PredicateValue[],
    /**
     * The object that is getting compared.
     */
    value: any,
}

/**
 * Object interface for arguments that get compared in the `IFilterOrderBy`.
 */
interface Predicate {
    /**
     * Returns the predicate value.
     */
    get: (value: any) => any,
    /**
     * `-1` for descending, `1` for ascending.
     */
    descending: number,
}

/**
 * Extend `angular` module `IAngularStatic` with `$$minErr` so the compiler doesn't freak out.
 */
declare module 'angular' {
    interface IAngularStatic {
        $$minErr: (module: string, ErrorConstructor?: (module: string) => void) => (code: string, template: string, ...templateArgs: any[]) => Error,
    }
}

/**
 * Implementation of the {@link IDefaultGetDataProvider} interface
 */
export class NgTableDefaultGetDataProvider implements IServiceProvider {
    /**
     * The name of a angular filter that knows how to apply the values returned by
     * `NgTableParams.filter()` to restrict an array of data.
     * (defaults to the angular `filter` filter service)
     */
    filterFilterName = 'filter';
    /**
     * The name of a angular filter that knows how to apply the values returned by
    * `NgTableParams.orderBy()` to sort an array of data.
    * (defaults to the angular `orderBy` filter service)
    */
    sortingFilterName = 'orderBy';
    $get: ($filter: IFilterService, $parse: IParseService, ngTableEventsChannel: NgTableEventsChannel) => IDefaultGetData<any>;
    constructor() {
        const provider = this;
        this.$get = ngTableDefaultGetData;

        ngTableDefaultGetData.$inject = ['$filter', '$parse', 'ngTableEventsChannel'];

        function ngTableDefaultGetData<T>($filter: IFilterService, $parse: IParseService, ngTableEventsChannel: NgTableEventsChannel): IDefaultGetData<T> {

            const defaultDataOptions = { applyFilter: true, applySort: true, applyPaging: true };

            (getData as IDefaultGetData<T>).applyPaging = applyPaging;
            (getData as IDefaultGetData<T>).getFilterFn = getFilterFn;
            (getData as IDefaultGetData<T>).getOrderByFn = getOrderByFn;

            return getData as IDefaultGetData<T>;

            function getFilterFn(params: NgTableParams<T>): IFilterFunc<T> {
                const filterOptions = params.settings().filterOptions;
                if (ng1.isFunction(filterOptions.filterFn)) {
                    return filterOptions.filterFn;
                } else {
                    return $filter<IFilterFilter>(filterOptions.filterFilterName || provider.filterFilterName);
                }
            }

            function getOrderByFn(params: NgTableParams<T>) {
                return function (array: any, sortPredicate: any, reverseOrder?: boolean, compareFn?: (v1: PredicateValue, v2: PredicateValue) => number) {
                    if (array === null) {
                        return array;
                    }

                    if (isArrayLike(array) !== true) {
                        throw ng1.$$minErr('orderBy')('notarray', 'Expected array but received: {0}', array);
                    }

                    if (ng1.isArray(sortPredicate) !== true) {
                        sortPredicate = [sortPredicate];
                    }

                    if (sortPredicate.length === 0) {
                        sortPredicate = ['+'];
                    }

                    const predicates = processPredicates(sortPredicate),
                        descending = reverseOrder ? -1 : 1,
                        compare = ng1.isFunction(compareFn) === true ? compareFn : defaultCompare;

                    return Array.prototype.map.call(array, getComparisonObject).sort(doComparison).map(function (item: ComparisonObject): any {
                        return item.value;
                    });

                    function getComparisonObject(value: any, index: number): ComparisonObject {
                        return {
                            tieBreaker: {
                                value: index,
                                type: 'number',
                                index: index,
                            },
                            predicateValues: predicates.map(function (predicate: Predicate): PredicateValue {
                                return getPredicateValue(predicate.get(value), index);
                            }),
                            value: value,
                        };
                    }

                    function doComparison(v1: ComparisonObject, v2: ComparisonObject): number {
                        for (let i = 0, l = predicates.length; i < l; i++) {
                            let result = compare(v1.predicateValues[i], v2.predicateValues[i]);

                            if (result) {
                                return result * predicates[i].descending * descending;
                            }
                        }

                        return (compare(v1.tieBreaker, v2.tieBreaker) || defaultCompare(v1.tieBreaker, v2.tieBreaker)) * descending;
                    }
                };
            }

            function processPredicates(sortPredicates: any[]): Predicate[] {
                return sortPredicates.map(function (predicate: any): Predicate {
                    let descending = 1,
                        get: any = ng1.identity;

                    if (ng1.isFunction(predicate) === true) {
                        get = predicate;
                    } else if (ng1.isString(predicate) === true) {
                        if (predicate.charAt(0) === '+' || predicate.charAt(0) === '-') {
                            descending = predicate.charAt(0) === '-' ? -1 : 1;
                            predicate = predicate.substring(1);
                        }

                        if (predicate !== '') {
                            get = $parse(predicate);

                            if (get.constant) {
                                let key: any = get();

                                get = function (value: any): any {
                                    return value[key];
                                };
                            }
                        }
                    }

                    return {
                        get: get,
                        descending: descending,
                    };
                });
            }

            function isPrimitive(value: any): boolean {
                switch (typeof value) {
                    case 'number':
                    case 'boolean':
                    case 'string':
                        return true;
                    default:
                        return false;
                }
            }

            function objectValue(value: any): any {
                // If `valueOf` is a valid function use that
                if (ng1.isFunction(value.valueOf) === true) {
                    value = value.valueOf();

                    if (isPrimitive(value) === true) {
                        return value;
                    }
                }

                // If `toString` is a valid function and not the one from `Object.prototype` use that
                if (hasCustomToString(value) === true) {
                    value = value.toString();

                    if (isPrimitive(value) === true) {
                        return value;
                    }
                }

                return value;
            }

            function getPredicateValue(value: any, index: number): PredicateValue {
                var type = typeof value;

                if (value === null) {
                    type = 'null';
                } else if (type === 'object') {
                    value = objectValue(value);
                }

                return {
                    value: value,
                    type: type,
                    index: index,
                };
            }

            function defaultCompare(v1: PredicateValue, v2: PredicateValue): number {
                const type1 = v1.type,
                    type2 = v2.type;

                let result = 0;

                if (type1 === type2) {
                    let value1 = v1.value,
                        value2 = v2.value;

                    if (type1 === 'string') {
                        // Compare strings case-insensitively
                        value1 = value1.toLowerCase();
                        value2 = value2.toLowerCase();
                    } else if (type1 === 'object') {
                        // For basic objects, use the position of the object in the collection instead of the value
                        if (ng1.isObject(value1) === true) {
                            value1 = v1.index;
                        }
                        if (ng1.isObject(value2) === true) {
                            value2 = v2.index;
                        }
                    }

                    if (value1 !== value2) {
                        result = value1 < value2 ? -1 : 1;
                    }
                } else {
                    result = (type1 === 'undefined') ? 1 :
                        (type2 === 'undefined') ? -1 :
                        (type1 === 'null') ? 1 :
                        (type2 === 'null') ? -1 :
                        (type1 < type2) ? -1 : 1;
                }

                return result;
            }

            function isArrayLike(value: any): boolean {
                if (value === null || isWindow(value) === true) {
                    return false;
                }

                if (ng1.isArray(value) === true || ng1.isString(value) === true || (ng1.element && value instanceof ng1.element)) {
                    return true;
                }

                const length = 'length' in Object(value) && value.length;

                return ng1.isNumber(length) === true && (length >= 0 && ((length - 1) in value || value instanceof Array) || typeof value.item == 'function');
            }

            function isWindow(value: any): boolean {
                return value && value.window === value;
            }

            function hasCustomToString(value: any): boolean {
                return ng1.isFunction(value.toString) === true && value.toString !== Object.prototype.toString;
            }

            function applyFilter(data: T[], params: NgTableParams<T>): T[] {
                if (!params.hasFilter()) {
                    return data;
                }

                const filter = params.filter(true);
                const filterKeys = Object.keys(filter);
                const parsedFilter = filterKeys.reduce((result, key) => {
                    result = setPath(result, filter[key], key);
                    return result;
                }, {});
                const filterFn = getFilterFn(params);
                return filterFn.call(params, data, parsedFilter, params.settings().filterOptions.filterComparator);
            }

            function applyPaging(data: T[], params: NgTableParams<any>): T[] {
                const pagedData = data.slice((params.page() - 1) * params.count(), params.page() * params.count());
                params.total(data.length); // set total for recalc pagination
                return pagedData;
            }

            function applySort(data: T[], params: NgTableParams<T>): T[] {
                const orderBy = params.orderBy();
                const orderByFn = getOrderByFn(params);
                return orderBy.length ? orderByFn(data, orderBy) : data;
            }

            function getData(data: T[], params: NgTableParams<T>): T[] {
                if (data == null) {
                    return [];
                }

                const options = ng1.extend({}, defaultDataOptions, params.settings().dataOptions);

                const fData = options.applyFilter ? applyFilter(data, params) : data;
                ngTableEventsChannel.publishAfterDataFiltered(params, fData);

                const orderedData = options.applySort ? applySort(fData, params) : fData;
                ngTableEventsChannel.publishAfterDataSorted(params,orderedData);

                return options.applyPaging ? applyPaging(orderedData, params) : orderedData;
            }

            // Sets the value at any depth in a nested object based on the path
            // note: adapted from: underscore-contrib#setPath
            function setPath(obj: any, value: any, path: string) {
                const keys = path.split('.');
                const ret = obj;
                const lastKey = keys[keys.length - 1];
                let target = ret;

                const parentPathKeys = keys.slice(0, keys.length - 1);
                parentPathKeys.forEach(function (key) {
                    if (!target.hasOwnProperty(key)) {
                        target[key] = {};
                    }
                    target = target[key];
                });

                target[lastKey] = value;
                return ret;
            }
        }
    }
}
