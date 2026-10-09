import fastIgnore, {type IgnoreMatcher, type Options, type PathOptions} from 'fast-ignore-rs';

const options: Options = {caseSensitive: true};
const pathOptions: PathOptions = {isDirectory: true};
const ignore: IgnoreMatcher = fastIgnore('build/', options);
const ignored: boolean = ignore('build', pathOptions);
const batch: boolean[] = ignore.batch(['build', 'src/index.ts'], {isDirectory: [true, false]});

void ignored;
void batch;
